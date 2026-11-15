"""Concurrent relationship and upload checks against disposable PostgreSQL."""

from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
import os
import secrets
from threading import Barrier
import pytest

pytestmark = pytest.mark.skipif(
    not os.getenv("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL is required"
)


def browser(user):
    from app import app, db, digest

    token = secrets.token_urlsafe(32)
    csrf = secrets.token_urlsafe(32)
    with db() as conn:
        conn.execute(
            "INSERT INTO sessions VALUES(%s,%s,%s,now()+interval '1 hour')",
            (digest(token), user, csrf),
        )
    client = app.test_client()
    client.set_cookie("session", token)
    return client, {"X-CSRF-Token": csrf}


def test_simultaneous_reciprocal_likes_create_one_connection(client, accounts):
    from app import db

    users, _ = accounts
    a, b, _ = users
    clients = [browser(a), browser(b)]
    barrier = Barrier(2)

    def like(index):
        other = [b, a][index]
        http, headers = clients[index]
        barrier.wait(timeout=10)
        return http.post(f"/api/v1/profiles/{other}/like", headers=headers).status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert list(executor.map(like, range(2))) == [200, 200]
    with db() as conn:
        assert (
            conn.execute(
                "SELECT count(*) AS n FROM likes WHERE actor=ANY(%s) AND target=ANY(%s)",
                ([a, b], [a, b]),
            ).fetchone()["n"]
            == 2
        )
        assert (
            conn.execute(
                "SELECT count(*) AS n FROM notifications WHERE actor=ANY(%s) AND target=ANY(%s) AND kind='match'",
                ([a, b], [a, b]),
            ).fetchone()["n"]
            == 2
        )


def test_block_racing_with_send_leaves_chat_disabled(client, accounts):
    from app import db

    users, sign_in = accounts
    a, b, _ = users
    for actor, target in [(a, b), (b, a)]:
        client.post(f"/api/v1/profiles/{target}/like", headers=sign_in(actor))
    blocker, block_headers = browser(a)
    sender, send_headers = browser(b)
    barrier = Barrier(2)

    def block():
        barrier.wait(timeout=10)
        return blocker.post(
            f"/api/v1/profiles/{b}/block", headers=block_headers
        ).status_code

    def send():
        barrier.wait(timeout=10)
        return sender.post(
            f"/api/v1/conversations/{a}/messages",
            json={"body": "Hello", "client_id": "race"},
            headers=send_headers,
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(block)
        second = executor.submit(send)
        assert first.result(timeout=20) == 200
        assert second.result(timeout=20) in (201, 403)
    assert sender.get(f"/api/v1/conversations/{a}/messages").status_code == 403
    with db() as conn:
        assert (
            conn.execute(
                "SELECT count(*) AS n FROM likes WHERE actor=ANY(%s) AND target=ANY(%s)",
                ([a, b], [a, b]),
            ).fetchone()["n"]
            == 0
        )


def test_simultaneous_uploads_cannot_exceed_five_photos(client, accounts, monkeypatch):
    from app import db
    from PIL import Image
    import storage

    users, _ = accounts
    a = users[0]
    with db() as conn:
        conn.execute("DELETE FROM photos WHERE user_id=%s", (a,))
    monkeypatch.setattr(storage, "put_photo", lambda key, body: None)
    image = BytesIO()
    Image.new("RGB", (8, 8), "green").save(image, "PNG")
    contents = image.getvalue()
    clients = [browser(a) for _ in range(6)]
    barrier = Barrier(6)

    def upload(index):
        http, headers = clients[index]
        barrier.wait(timeout=10)
        return http.post(
            "/api/v1/me/photos",
            data={"photo": (BytesIO(contents), "photo.png")},
            headers=headers,
        ).status_code

    with ThreadPoolExecutor(max_workers=6) as executor:
        statuses = list(executor.map(upload, range(6)))
    assert statuses.count(201) == 5 and statuses.count(400) == 1
    with db() as conn:
        assert (
            conn.execute(
                "SELECT count(*) AS n FROM photos WHERE user_id=%s", (a,)
            ).fetchone()["n"]
            == 5
        )
        assert (
            conn.execute(
                "SELECT count(*) AS n FROM photos WHERE user_id=%s AND is_primary", (a,)
            ).fetchone()["n"]
            == 1
        )
