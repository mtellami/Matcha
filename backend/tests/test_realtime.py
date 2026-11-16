import os
import pytest

pytestmark = pytest.mark.skipif(
    not os.getenv("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL is required"
)


def match(client, accounts):
    users, sign_in = accounts
    a, b, _ = users
    for actor, target in [(a, b), (b, a)]:
        assert (
            client.post(
                f"/api/v1/profiles/{target}/like", headers=sign_in(actor)
            ).status_code
            == 200
        )
    return users, sign_in


def test_incremental_history_recovers_a_large_offline_burst(client, accounts):
    from app import db

    users, sign_in = match(client, accounts)
    a, b, _ = users
    with db() as conn:
        for number in range(120):
            conn.execute(
                "INSERT INTO messages(actor,target,body,client_id) VALUES(%s,%s,%s,%s)",
                (b, a, str(number), str(number)),
            )
    sign_in(a)
    after = 0
    received = []
    while True:
        response = client.get(f"/api/v1/conversations/{b}/messages?after={after}")
        assert response.status_code == 200
        page = response.json
        received.extend(page["messages"])
        if page["next_after"] is None:
            break
        assert page["next_after"] > after
        after = page["next_after"]
    assert len(received) == 120 and len({m["id"] for m in received}) == 120
    assert [int(m["body"]) for m in received] == list(range(120))
    assert (
        client.get(
            f"/api/v1/conversations/{b}/messages?after={received[-1]['id']}"
        ).json["messages"]
        == []
    )


def test_history_rejects_ambiguous_or_invalid_cursors(client, accounts):
    users, sign_in = match(client, accounts)
    a, b, _ = users
    sign_in(a)
    for query in [
        "after=-1",
        "after=",
        "after=nan",
        "after=1.5",
        "after=9223372036854775808",
        "after=0&before=1",
    ]:
        assert (
            client.get(f"/api/v1/conversations/{b}/messages?{query}").status_code == 400
        )


def test_expired_session_is_disconnected_on_socket_heartbeat(client, accounts):
    from app import app, socketio, db

    users, sign_in = accounts
    sign_in(users[0])
    socket = socketio.test_client(app, flask_test_client=client)
    assert socket.is_connected()
    assert socket.emit("heartbeat", callback=True) == {"authenticated": True}
    with db() as conn:
        conn.execute(
            "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE user_id=%s",
            (users[0],),
        )
    socket.emit("heartbeat")
    assert not socket.is_connected()


def test_delivery_retry_keeps_failed_events_pending(client, accounts, monkeypatch):
    from app import app, socketio, db, deliver_pending_events

    users, sign_in = accounts
    a, b, _ = users
    sign_in(a)
    socket = socketio.test_client(app, flask_test_client=client)
    try:
        with db() as conn:
            event = conn.execute(
                "INSERT INTO notifications(actor,target,kind) VALUES(%s,%s,'visit') RETURNING id",
                (b, a),
            ).fetchone()["id"]
        original = socketio.emit

        def unavailable(*args, **kwargs):
            raise RuntimeError("transport unavailable")

        monkeypatch.setattr(socketio, "emit", unavailable)
        with pytest.raises(RuntimeError):
            deliver_pending_events()
        with db() as conn:
            assert not conn.execute(
                "SELECT delivered FROM notifications WHERE id=%s", (event,)
            ).fetchone()["delivered"]
        monkeypatch.setattr(socketio, "emit", original)
        deliver_pending_events()
        assert len(socket.get_received()) == 1
        deliver_pending_events()
        assert not socket.get_received()
    finally:
        socket.disconnect()


def test_reconnect_uses_persisted_history_after_notifications_were_delivered_offline(
    client, accounts
):
    from app import app, socketio, deliver_pending_events

    users, sign_in = match(client, accounts)
    a, b, _ = users
    sign_in(a)
    socket = socketio.test_client(app, flask_test_client=client)
    socket.disconnect()
    headers = sign_in(b)
    assert (
        client.post(
            f"/api/v1/conversations/{a}/messages",
            json={"body": "While you were away", "client_id": "offline-message"},
            headers=headers,
        ).status_code
        == 201
    )
    deliver_pending_events()
    sign_in(a)
    reconnected = socketio.test_client(app, flask_test_client=client)
    try:
        assert reconnected.is_connected()
        history = client.get(f"/api/v1/conversations/{b}/messages?after=0").json[
            "messages"
        ]
        assert [m["body"] for m in history] == ["While you were away"]
    finally:
        reconnected.disconnect()
