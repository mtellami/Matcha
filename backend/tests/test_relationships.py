"""Run against a migrated, disposable PostgreSQL database via TEST_DATABASE_URL."""

import os
import pytest

pytestmark = pytest.mark.skipif(
    not os.getenv("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL is required"
)


def connect(client, users, sign_in):
    a, b, _ = users
    for actor, target in [(a, b), (b, a)]:
        headers = sign_in(actor)
        assert (
            client.post(f"/api/v1/profiles/{target}/like", headers=headers).status_code
            == 200
        )


def test_picture_is_required_for_like(client, accounts):
    from app import db

    users, sign_in = accounts
    a, b, _ = users
    with db() as conn:
        conn.execute("DELETE FROM photos WHERE user_id=%s", (a,))
    response = client.post(f"/api/v1/profiles/{b}/like", headers=sign_in(a))
    assert response.status_code == 400


def test_chat_requires_match_and_retries_are_idempotent(client, accounts):
    from app import db

    users, sign_in = accounts
    a, b, _ = users
    headers = sign_in(a)
    assert client.get(f"/api/v1/conversations/{b}/messages").status_code == 403
    connect(client, users, sign_in)
    headers = sign_in(a)
    message = {"body": "Hello <script>literal text</script>", "client_id": "retry-key"}
    for _ in range(2):
        assert (
            client.post(
                f"/api/v1/conversations/{b}/messages", json=message, headers=headers
            ).status_code
            == 201
        )
    with db() as conn:
        assert (
            conn.execute(
                "SELECT count(*) AS n FROM messages WHERE actor=%s AND target=%s",
                (a, b),
            ).fetchone()["n"]
            == 1
        )
    assert (
        client.post(
            f"/api/v1/conversations/{b}/messages",
            json={**message, "body": "Different"},
            headers=headers,
        ).status_code
        == 409
    )
    sign_in(b)
    summary = client.get("/api/v1/me/summary").json
    assert summary["messages"] == 1
    received = client.get(f"/api/v1/conversations/{a}/messages").json["messages"]
    assert received[0]["body"] == message["body"]
    before_notifications = summary["notifications"]
    headers = sign_in(b)
    assert (
        client.post(
            f"/api/v1/conversations/{a}/read",
            json={"through_id": received[0]["id"]},
            headers=headers,
        ).status_code
        == 200
    )
    summary = client.get("/api/v1/me/summary").json
    assert summary["messages"] == 0 and summary["notifications"] == before_notifications


def test_unlike_disables_chat_and_mutes_future_notifications(client, accounts):
    from app import db

    users, sign_in = accounts
    a, b, _ = users
    connect(client, users, sign_in)
    assert (
        client.delete(f"/api/v1/profiles/{b}/like", headers=sign_in(a)).status_code
        == 200
    )
    assert client.get(f"/api/v1/conversations/{b}/messages").status_code == 403
    with db() as conn:
        before = conn.execute(
            "SELECT count(*) AS n FROM notifications WHERE actor=%s AND target=%s",
            (b, a),
        ).fetchone()["n"]
    sign_in(b)
    assert client.get(f"/api/v1/profiles/{a}").status_code == 200
    with db() as conn:
        assert (
            conn.execute(
                "SELECT count(*) AS n FROM notifications WHERE actor=%s AND target=%s",
                (b, a),
            ).fetchone()["n"]
            == before
        )
    assert "disconnect" in [
        n["kind"] for n in client.get("/api/v1/notifications").json["notifications"]
    ]


def test_block_hides_profile_and_messages_and_unblock_does_not_restore_likes(
    client, accounts
):
    users, sign_in = accounts
    a, b, _ = users
    connect(client, users, sign_in)
    assert (
        client.post(f"/api/v1/profiles/{b}/block", headers=sign_in(a)).status_code
        == 200
    )
    sign_in(b)
    assert client.get(f"/api/v1/profiles/{a}").status_code == 404
    assert client.get(f"/api/v1/conversations/{a}/messages").status_code == 403
    assert a not in [p["id"] for p in client.get("/api/v1/profiles").json["profiles"]]
    assert not client.get("/api/v1/notifications").json["notifications"]
    assert (
        client.delete(f"/api/v1/profiles/{b}/block", headers=sign_in(a)).status_code
        == 200
    )
    response = client.get(f"/api/v1/profiles/{b}").json
    assert (
        not response["connected"]
        and not response["liked"]
        and not response["likes_you"]
    )


def test_presence_handles_multiple_tabs_and_logout(client, accounts):
    users, sign_in = accounts
    a, b, _ = users
    headers = sign_in(a)
    for tab in ("first", "second"):
        assert (
            client.post(
                "/api/v1/me/presence", json={"tab_id": tab}, headers=headers
            ).status_code
            == 200
        )
    client.delete("/api/v1/me/presence", json={"tab_id": "first"}, headers=headers)
    assert client.get(f"/api/v1/profiles/{a}/status").json["online"]
    assert client.post("/api/v1/auth/logout", headers=headers).status_code == 200
    sign_in(b)
    assert not client.get(f"/api/v1/profiles/{a}/status").json["online"]


def test_read_cursor_does_not_consume_newer_messages(client, accounts):
    users, sign_in = accounts
    a, b, _ = users
    connect(client, users, sign_in)
    headers = sign_in(a)
    client.post(
        f"/api/v1/conversations/{b}/messages",
        json={"body": "first", "client_id": "first"},
        headers=headers,
    )
    sign_in(b)
    last = client.get(f"/api/v1/conversations/{a}/messages").json["messages"][-1]["id"]
    headers = sign_in(a)
    client.post(
        f"/api/v1/conversations/{b}/messages",
        json={"body": "newer", "client_id": "newer"},
        headers=headers,
    )
    headers = sign_in(b)
    client.post(
        f"/api/v1/conversations/{a}/read", json={"through_id": last}, headers=headers
    )
    assert client.get("/api/v1/me/summary").json["messages"] == 1


def test_revoked_session_does_not_receive_socket_events(client, accounts):
    from app import app, socketio, db, deliver_pending_events

    users, sign_in = accounts
    a, b, _ = users
    headers = sign_in(a)
    socket = socketio.test_client(app, flask_test_client=client)
    assert socket.is_connected()
    try:
        with db() as conn:
            conn.execute(
                "INSERT INTO notifications(actor,target,kind) VALUES(%s,%s,'visit')",
                (b, a),
            )
        deliver_pending_events()
        assert [e["name"] for e in socket.get_received()] == ["notification"]
        client.post("/api/v1/auth/logout", headers=headers)
        with db() as conn:
            conn.execute(
                "INSERT INTO notifications(actor,target,kind) VALUES(%s,%s,'visit')",
                (b, a),
            )
        deliver_pending_events()
        assert not socket.get_received()
    finally:
        socket.disconnect()


def test_expired_presence_is_offline_even_with_live_session(client, accounts):
    from app import db

    users, sign_in = accounts
    a, b, _ = users
    headers = sign_in(a)
    client.post("/api/v1/me/presence", json={"tab_id": "expired"}, headers=headers)
    with db() as conn:
        conn.execute(
            "UPDATE presence SET expires_at=now()-interval '1 second' WHERE tab_id='expired'"
        )
    sign_in(b)
    assert not client.get(f"/api/v1/profiles/{a}/status").json["online"]


def test_malformed_profile_fields_are_handled(client, accounts):
    users, sign_in = accounts
    headers = sign_in(users[0])
    fields = {
        "first_name": "Test",
        "last_name": "Account",
        "birth_date": "1995-01-01",
        "gender": "woman",
        "preferences": ["woman"],
        "bio": "Testing",
        "city": "Rabat",
        "latitude": 34.02,
        "longitude": -6.84,
        "tags": ["coffee"],
    }
    for invalid in [
        {"gender": []},
        {"preferences": [{}]},
        {"birth_date": []},
        {"tags": []},
    ]:
        response = client.put(
            "/api/v1/me/profile", json={**fields, **invalid}, headers=headers
        )
        assert response.status_code == 400
        assert isinstance(response.json["error"]["code"], str)


def test_public_profile_hides_account_and_precise_location_fields(client, accounts):
    users, sign_in = accounts
    sign_in(users[0])
    response = client.get(f"/api/v1/profiles/{users[1]}")
    assert response.status_code == 200
    assert (
        not {
            "email",
            "password",
            "password_hash",
            "latitude",
            "longitude",
            "birth_date",
            "token",
        }
        & response.json.keys()
    )
    assert {
        "age",
        "city",
        "gender",
        "preferences",
        "bio",
        "tags",
        "fame",
        "online",
        "last_seen",
    } <= response.json.keys()


def test_csrf_is_required_even_for_authenticated_users(client, accounts):
    users, sign_in = accounts
    sign_in(users[0])
    assert client.post(f"/api/v1/profiles/{users[1]}/like").status_code == 403
    assert client.post("/api/v1/auth/logout").status_code == 403
    assert client.get("/api/v1/me").status_code == 200


def test_message_history_cursor_has_no_duplicates(client, accounts):
    from app import db

    users, sign_in = accounts
    a, b, _ = users
    connect(client, users, sign_in)
    with db() as conn:
        for i in range(55):
            conn.execute(
                "INSERT INTO messages(actor,target,body,client_id) VALUES(%s,%s,%s,%s)",
                (a, b, str(i), str(i)),
            )
    sign_in(b)
    first = client.get(f"/api/v1/conversations/{a}/messages").json
    second = client.get(
        f"/api/v1/conversations/{a}/messages?before={first['next_before']}"
    ).json
    assert len(first["messages"]) == 50 and len(second["messages"]) == 5
    assert not set(m["id"] for m in first["messages"]) & set(
        m["id"] for m in second["messages"]
    )
    assert second["next_before"] is None


def test_password_reset_rejects_reuse_and_invalidates_sessions(client, accounts):
    from app import db, digest
    import secrets

    users, sign_in = accounts
    a = users[0]
    sign_in(a)
    token = secrets.token_urlsafe(32)
    with db() as conn:
        conn.execute(
            "INSERT INTO tokens(token,user_id,kind,expires_at) VALUES(%s,%s,'reset',now()+interval '1 hour')",
            (digest(token), a),
        )
    fields = {"kind": "reset", "token": token, "password": "RiverCloud!48&Lantern"}
    assert client.post("/api/v1/auth/token", json=fields).status_code == 200
    assert client.get("/api/v1/me").status_code == 401
    assert client.post("/api/v1/auth/token", json=fields).status_code == 400


def test_duplicate_username_returns_field_feedback(client, accounts):
    users, sign_in = accounts
    sign_in(users[0])
    username = client.get("/api/v1/me").json["user"]["username"]
    response = client.post(
        "/api/v1/auth/register",
        json={
            "username": username,
            "email": "duplicate-" + username + "@example.test",
            "first_name": "Test",
            "last_name": "Account",
            "password": "RiverCloud!48&Lantern",
        },
    )
    assert (
        response.status_code == 409 and "username" in response.json["error"]["fields"]
    )
