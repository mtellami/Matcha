from app import socketio
from app import (
    connected,
    current_session,
    db,
    disconnect,
    is_online,
    join_room,
    lock_account,
    pair_lock,
    request,
    secrets,
)


@socketio.on("connect")
def socket_connect(auth_payload=None):
    session = current_session()
    if not session:
        return False
    join_room("session:" + session["token"])


def broadcast_presence(user_id, online):
    """Send presence hints only to mutual, unblocked connections."""
    with db() as conn:
        peers = conn.execute(
            """SELECT DISTINCT a.target AS id FROM likes a
               JOIN likes b ON b.actor=a.target AND b.target=a.actor
               WHERE a.actor=%s
                 AND NOT EXISTS(
                   SELECT 1 FROM blocks x
                   WHERE (x.actor=%s AND x.target=a.target)
                      OR (x.actor=a.target AND x.target=%s)
                 )""",
            (user_id, user_id, user_id),
        ).fetchall()
        sessions = []
        for peer in peers:
            sessions.extend(
                conn.execute(
                    "SELECT token FROM sessions WHERE user_id=%s AND expires_at>now()",
                    (peer["id"],),
                ).fetchall()
            )
    payload = {"user_id": user_id, "online": online}
    for session in sessions:
        socketio.emit("presence:changed", payload, to="session:" + session["token"])


def update_socket_presence(session):
    user_id = session["user_id"]
    became_online = False
    with db() as conn:
        lock_account(conn, user_id, session["token"])
        was_online = is_online(conn, user_id)
        conn.execute(
            """INSERT INTO presence(session_token,tab_id,expires_at)
               VALUES(%s,%s,now()+interval '20 seconds')
               ON CONFLICT(session_token,tab_id)
               DO UPDATE SET expires_at=EXCLUDED.expires_at""",
            (session["token"], request.sid),
        )
        if not was_online:
            conn.execute("UPDATE users SET last_seen=now() WHERE id=%s", (user_id,))
            became_online = True
    if became_online:
        broadcast_presence(user_id, True)


@socketio.on("disconnect")
def socket_disconnect(reason=None):
    session = current_session()
    if not session:
        return
    user_id = session["user_id"]
    became_offline = False
    with db() as conn:
        lock_account(conn, user_id, session["token"])
        was_online = is_online(conn, user_id)
        removed = conn.execute(
            "DELETE FROM presence WHERE session_token=%s AND tab_id=%s RETURNING tab_id",
            (session["token"], request.sid),
        ).fetchone()
        if removed and was_online and not is_online(conn, user_id):
            conn.execute("UPDATE users SET last_seen=now() WHERE id=%s", (user_id,))
            became_offline = True
    if became_offline:
        broadcast_presence(user_id, False)


@socketio.on("heartbeat")
def socket_heartbeat():
    session = current_session()
    if not session:
        socketio.emit("session_expired", to=request.sid)
        disconnect()
        return {"authenticated": False}
    update_socket_presence(session)
    return {"authenticated": True}


def emit_user_sessions(conn, user_id, event, payload, except_session=None):
    sessions = conn.execute(
        "SELECT token FROM sessions WHERE user_id=%s AND expires_at>now()",
        (user_id,),
    ).fetchall()
    for session in sessions:
        if session["token"] != except_session:
            socketio.emit(event, payload, to="session:" + session["token"])


@socketio.on("conversation:typing")
def socket_conversation_typing(payload):
    session = current_session()
    peer_id = payload.get("peer_id") if isinstance(payload, dict) else None
    is_typing = payload.get("is_typing") if isinstance(payload, dict) else None
    if (
        not session
        or isinstance(peer_id, bool)
        or not isinstance(peer_id, int)
        or not isinstance(is_typing, bool)
    ):
        return {"ok": False}
    with db() as conn:
        pair_lock(conn, session["user_id"], peer_id)
        if not connected(conn, session["user_id"], peer_id):
            return {"ok": False}
        emit_user_sessions(
            conn,
            peer_id,
            "conversation:typing",
            {"conversation_id": session["user_id"], "is_typing": is_typing},
        )
    return {"ok": True}


def socket_call(payload, statuses):
    session = current_session()
    if not session:
        return None, None, None, {"ok": False, "error": "Your session expired"}
    call_id = payload.get("call_id") if isinstance(payload, dict) else None
    if not isinstance(call_id, str) or not 20 <= len(call_id) <= 80:
        return None, None, None, {"ok": False, "error": "Invalid call"}
    with db() as conn:
        call = conn.execute(
            "SELECT * FROM calls WHERE id=%s AND expires_at>now() FOR UPDATE",
            (call_id,),
        ).fetchone()
        if not call or call["status"] not in statuses:
            return (
                None,
                None,
                None,
                {"ok": False, "error": "Call is no longer available"},
            )
        if session["user_id"] == call["caller"]:
            peer_id = call["callee"]
        elif session["user_id"] == call["callee"]:
            peer_id = call["caller"]
        else:
            return None, None, None, {"ok": False, "error": "Call is unavailable"}
        if not connected(conn, session["user_id"], peer_id):
            conn.execute("DELETE FROM calls WHERE id=%s", (call_id,))
            emit_user_sessions(
                conn,
                peer_id,
                "call:ended",
                {"call_id": call_id, "reason": "connection_changed"},
            )
            return (
                None,
                None,
                None,
                {
                    "ok": False,
                    "error": "Calls are available to connected users",
                },
            )
    return session, call, peer_id, None


@socketio.on("call:start")
def socket_call_start(payload):
    session = current_session()
    target = payload.get("target") if isinstance(payload, dict) else None
    media = payload.get("media") if isinstance(payload, dict) else None
    if not session:
        return {"ok": False, "error": "Your session expired"}
    if (
        isinstance(target, bool)
        or not isinstance(target, int)
        or media not in ("audio", "video")
    ):
        return {"ok": False, "error": "Invalid call request"}
    with db() as conn:
        if (
            target == session["user_id"]
            or not conn.execute(
                "SELECT 1 FROM users WHERE id=%s AND verified", (target,)
            ).fetchone()
        ):
            return {"ok": False, "error": "Choose an available connected profile"}
        pair_lock(conn, session["user_id"], target)
        if not connected(conn, session["user_id"], target):
            return {"ok": False, "error": "Calls are available to connected users"}
        if not is_online(conn, target):
            return {"ok": False, "error": "This person is not online right now"}
        conn.execute("DELETE FROM calls WHERE expires_at<=now()")
        busy = conn.execute(
            """SELECT 1 FROM calls WHERE expires_at>now()
               AND (caller IN (%s,%s) OR callee IN (%s,%s)) LIMIT 1""",
            (session["user_id"], target, session["user_id"], target),
        ).fetchone()
        if busy:
            return {"ok": False, "error": "One of you is already in a call"}
        call_id = secrets.token_urlsafe(24)
        conn.execute(
            "INSERT INTO calls(id,caller,callee,media,status,expires_at) VALUES(%s,%s,%s,%s,'ringing',now()+interval '60 seconds')",
            (call_id, session["user_id"], target, media),
        )
        caller = conn.execute(
            "SELECT first_name FROM users WHERE id=%s", (session["user_id"],)
        ).fetchone()
        emit_user_sessions(
            conn,
            target,
            "call:incoming",
            {
                "call_id": call_id,
                "caller_id": session["user_id"],
                "caller_name": caller["first_name"],
                "media": media,
            },
        )
    return {"ok": True, "call_id": call_id}


@socketio.on("call:accept")
def socket_call_accept(payload):
    session, call, peer_id, error = socket_call(payload, ("ringing",))
    if error:
        return error
    if session["user_id"] != call["callee"]:
        return {"ok": False, "error": "Only the invited person can accept"}
    with db() as conn:
        accepted = conn.execute(
            """UPDATE calls SET status='active',expires_at=now()+interval '20 seconds'
               WHERE id=%s AND status='ringing' AND expires_at>now() RETURNING id""",
            (call["id"],),
        ).fetchone()
        if not accepted:
            return {"ok": False, "error": "Call is no longer available"}
        emit_user_sessions(
            conn,
            peer_id,
            "call:accepted",
            {"call_id": call["id"]},
        )
    return {"ok": True}


@socketio.on("call:decline")
def socket_call_decline(payload):
    session, call, peer_id, error = socket_call(payload, ("ringing",))
    if error:
        return error
    if session["user_id"] != call["callee"]:
        return {"ok": False, "error": "Only the invited person can decline"}
    with db() as conn:
        declined = conn.execute(
            "DELETE FROM calls WHERE id=%s AND status='ringing' RETURNING id",
            (call["id"],),
        ).fetchone()
        if not declined:
            return {"ok": False, "error": "Call is no longer available"}
        emit_user_sessions(conn, peer_id, "call:declined", {"call_id": call["id"]})
    return {"ok": True}


@socketio.on("call:offer")
def socket_call_offer(payload):
    session, call, peer_id, error = socket_call(payload, ("active",))
    description = payload.get("description") if isinstance(payload, dict) else None
    if error:
        return error
    if session["user_id"] != call["caller"]:
        return {"ok": False, "error": "Only the caller can send an offer"}
    if (
        not isinstance(description, dict)
        or description.get("type") != "offer"
        or not isinstance(description.get("sdp"), str)
        or len(description["sdp"]) > 100_000
    ):
        return {"ok": False, "error": "Invalid call offer"}
    with db() as conn:
        emit_user_sessions(
            conn,
            peer_id,
            "call:offer",
            {"call_id": call["id"], "description": description},
        )
    return {"ok": True}


@socketio.on("call:answer")
def socket_call_answer(payload):
    session, call, peer_id, error = socket_call(payload, ("active",))
    description = payload.get("description") if isinstance(payload, dict) else None
    if error:
        return error
    if session["user_id"] != call["callee"]:
        return {"ok": False, "error": "Only the invited person can send an answer"}
    if (
        not isinstance(description, dict)
        or description.get("type") != "answer"
        or not isinstance(description.get("sdp"), str)
        or len(description["sdp"]) > 100_000
    ):
        return {"ok": False, "error": "Invalid call answer"}
    with db() as conn:
        emit_user_sessions(
            conn,
            peer_id,
            "call:answer",
            {"call_id": call["id"], "description": description},
        )
    return {"ok": True}


@socketio.on("call:ice")
def socket_call_ice(payload):
    session, call, peer_id, error = socket_call(payload, ("active",))
    candidate = payload.get("candidate") if isinstance(payload, dict) else None
    if error:
        return error
    if not isinstance(candidate, dict) or len(str(candidate)) > 5000:
        return {"ok": False, "error": "Invalid connection candidate"}
    with db() as conn:
        emit_user_sessions(
            conn,
            peer_id,
            "call:ice",
            {"call_id": call["id"], "candidate": candidate},
        )
    return {"ok": True}


@socketio.on("call:heartbeat")
def socket_call_heartbeat(payload):
    _, call, _, error = socket_call(payload, ("active",))
    if error:
        return error
    with db() as conn:
        conn.execute(
            "UPDATE calls SET expires_at=now()+interval '20 seconds' WHERE id=%s AND status='active'",
            (call["id"],),
        )
    return {"ok": True, "call_id": call["id"]}


@socketio.on("call:end")
def socket_call_end(payload):
    session, call, peer_id, error = socket_call(payload, ("ringing", "active"))
    if error:
        return error
    with db() as conn:
        conn.execute("DELETE FROM calls WHERE id=%s", (call["id"],))
        emit_user_sessions(
            conn,
            peer_id,
            "call:ended",
            {"call_id": call["id"], "reason": "ended"},
        )
    return {"ok": True}
