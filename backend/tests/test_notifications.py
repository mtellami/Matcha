"""Notification ownership, filtering, and independent read acknowledgements."""

import os
import pytest

pytestmark = pytest.mark.skipif(
    not os.getenv("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL is required"
)


def test_reading_one_event_preserves_other_unread_events_and_messages(client, accounts):
    from app import db

    users, sign_in = accounts
    a, b, c = users
    with db() as conn:
        ids = [
            conn.execute(
                "INSERT INTO notifications(actor,target,kind) VALUES(%s,%s,'like') RETURNING id",
                (actor, a),
            ).fetchone()["id"]
            for actor in [b, c]
        ]
        conn.execute(
            "INSERT INTO messages(actor,target,body,client_id) VALUES(%s,%s,'Hello','notification-read')",
            (b, a),
        )
        conn.execute("INSERT INTO likes VALUES(%s,%s),(%s,%s)", (a, b, b, a))
    headers = sign_in(a)
    for _ in range(2):
        assert (
            client.post(
                f"/api/v1/notifications/{ids[0]}/read", headers=headers
            ).status_code
            == 200
        )
    assert [
        n["id"]
        for n in client.get("/api/v1/notifications?unread=true").json["notifications"]
    ] == [ids[1]]
    summary = client.get("/api/v1/me/summary").json
    assert summary["notifications"] == 1 and summary["messages"] == 1
    assert len(client.get("/api/v1/notifications").json["notifications"]) == 2


def test_notification_read_requires_owner_and_csrf(client, accounts):
    from app import db

    users, sign_in = accounts
    a, b, _ = users
    with db() as conn:
        event = conn.execute(
            "INSERT INTO notifications(actor,target,kind) VALUES(%s,%s,'visit') RETURNING id",
            (b, a),
        ).fetchone()["id"]
    headers = sign_in(b)
    assert (
        client.post(f"/api/v1/notifications/{event}/read", headers=headers).status_code
        == 404
    )
    headers = sign_in(a)
    assert client.post(f"/api/v1/notifications/{event}/read").status_code == 403
    for invalid in [0, 9223372036854775808]:
        assert (
            client.post(
                f"/api/v1/notifications/{invalid}/read", headers=headers
            ).status_code
            == 400
        )
    assert (
        len(client.get("/api/v1/notifications?unread=true").json["notifications"]) == 1
    )


def test_unread_pagination_is_complete_and_includes_public_sender_details(
    client, accounts
):
    from app import db

    users, sign_in = accounts
    a, b, _ = users
    with db() as conn:
        for i in range(120):
            conn.execute(
                "INSERT INTO notifications(actor,target,kind,is_read) VALUES(%s,%s,'visit',%s)",
                (b, a, i % 3 == 0),
            )
    sign_in(a)
    first = client.get("/api/v1/notifications?unread=true").json
    second = client.get(
        f"/api/v1/notifications?unread=true&before={first['next_before']}"
    ).json
    assert len(first["notifications"]) == 50 and len(second["notifications"]) == 30
    all_events = first["notifications"] + second["notifications"]
    assert len({n["id"] for n in all_events}) == 80
    assert second["next_before"] is None and all(not n["is_read"] for n in all_events)
    assert all_events[0]["first_name"] == "Test" and all_events[0]["photo_id"]
    assert (
        not {"email", "password_hash", "latitude", "longitude"} & all_events[0].keys()
    )
    assert client.get("/api/v1/notifications?unread=maybe").status_code == 400


def test_unread_filter_respects_blocks_and_notification_mutes(client, accounts):
    from app import db

    users, sign_in = accounts
    a, b, c = users
    with db() as conn:
        conn.execute(
            "INSERT INTO notifications(actor,target,kind) VALUES(%s,%s,'visit'),(%s,%s,'like')",
            (b, a, c, a),
        )
        conn.execute("INSERT INTO blocks VALUES(%s,%s)", (b, a))
        conn.execute("INSERT INTO muted_notifications VALUES(%s,%s)", (c, a))
    sign_in(a)
    assert not client.get("/api/v1/notifications?unread=true").json["notifications"]
