from concurrent.futures import ThreadPoolExecutor
import os
import secrets
import time
from threading import Barrier, Event
from types import SimpleNamespace
import pytest

pytestmark = pytest.mark.skipif(
    not os.getenv("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL is required"
)
OLD_PASSWORD = "RiverCloud!48&Lantern"
NEW_PASSWORD = "Glacier!91&Orbit-Fern"


def make_token(user, kind="reset", expired=False, pending_email=None):
    from app import db, digest

    raw = secrets.token_urlsafe(32)
    with db() as conn:
        conn.execute(
            "INSERT INTO tokens(token,user_id,kind,expires_at,pending_email) VALUES(%s,%s,%s,now()+%s::interval,%s)",
            (
                digest(raw),
                user,
                kind,
                "-1 second" if expired else "1 hour",
                pending_email,
            ),
        )
    return raw


def test_old_password_login_cannot_survive_a_concurrent_reset(
    client, accounts, monkeypatch
):
    import app

    users, _ = accounts
    user = users[0]
    original = app.ph
    with app.db() as conn:
        username = conn.execute(
            "UPDATE users SET password_hash=%s WHERE id=%s RETURNING username",
            (original.hash(OLD_PASSWORD), user),
        ).fetchone()["username"]
    token = make_token(user)
    verifying = Event()
    release_login = Event()
    reset_lock_started = Event()
    reset_pid = []
    original_lock = app.lock_account

    def verify(*args, **kwargs):
        result = original.verify(*args, **kwargs)
        verifying.set()
        if not release_login.wait(10):
            raise RuntimeError("Test did not release login")
        return result

    def lock_account(conn, user_id, session_token=None):
        reset_pid.append(conn.info.backend_pid)
        reset_lock_started.set()
        return original_lock(conn, user_id, session_token)

    monkeypatch.setattr(app, "ph", SimpleNamespace(verify=verify, hash=original.hash))
    monkeypatch.setattr(app, "lock_account", lock_account)
    login_client = app.app.test_client()
    reset_client = app.app.test_client()
    with ThreadPoolExecutor(max_workers=2) as executor:
        login = executor.submit(
            login_client.post,
            "/api/v1/auth/login",
            json={"username": username, "password": OLD_PASSWORD},
        )
        try:
            assert verifying.wait(10)
            reset = executor.submit(
                reset_client.post,
                "/api/v1/auth/token",
                json={"kind": "reset", "token": token, "password": NEW_PASSWORD},
            )
            assert reset_lock_started.wait(10)
            waiting = False
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline and not reset.done():
                with app.db() as conn:
                    activity = conn.execute(
                        "SELECT wait_event_type FROM pg_stat_activity WHERE pid=%s",
                        (reset_pid[0],),
                    ).fetchone()
                if activity and activity["wait_event_type"] == "Lock":
                    waiting = True
                    break
                time.sleep(0.01)
            assert (
                waiting
            ), "Reset must wait for the login account lock before revoking sessions"
            release_login.set()
            assert login.result(timeout=20).status_code == 200
            assert reset.result(timeout=20).status_code == 200
        finally:
            release_login.set()
    assert login_client.get("/api/v1/me").status_code == 401
    monkeypatch.setattr(app, "ph", original)
    assert (
        client.post(
            "/api/v1/auth/login", json={"username": username, "password": OLD_PASSWORD}
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/api/v1/auth/login", json={"username": username, "password": NEW_PASSWORD}
        ).status_code
        == 200
    )


def test_reset_revokes_pending_email_links_sessions_and_presence(client, accounts):
    import app

    users, sign_in = accounts
    user = users[0]
    headers = sign_in(user)
    client.post(
        "/api/v1/me/presence", headers=headers, json={"tab_id": "security-test"}
    )
    reset = make_token(user)
    email = make_token(
        user, "email", pending_email=f"{secrets.token_hex(8)}@example.test"
    )
    assert (
        client.post(
            "/api/v1/auth/token",
            json={"kind": "reset", "token": reset, "password": NEW_PASSWORD},
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/api/v1/auth/token", json={"kind": "email", "token": email}
        ).status_code
        == 400
    )
    with app.db() as conn:
        assert not conn.execute(
            "SELECT 1 FROM tokens WHERE user_id=%s", (user,)
        ).fetchone()
        assert not conn.execute(
            "SELECT 1 FROM sessions WHERE user_id=%s", (user,)
        ).fetchone()
        assert not app.is_online(conn, user)


def test_email_confirmation_invalidates_reset_links_sent_to_old_address(
    client, accounts
):
    import app

    users, sign_in = accounts
    user = users[0]
    sign_in(user)
    target = f"{secrets.token_hex(8)}@example.test"
    reset = make_token(user)
    email = make_token(user, "email", pending_email=target)
    assert (
        client.post(
            "/api/v1/auth/token", json={"kind": "email", "token": email}
        ).status_code
        == 200
    )
    assert client.get("/api/v1/me").status_code == 401
    assert (
        client.post(
            "/api/v1/auth/token",
            json={"kind": "reset", "token": reset, "password": NEW_PASSWORD},
        ).status_code
        == 400
    )
    with app.db() as conn:
        assert (
            conn.execute("SELECT email FROM users WHERE id=%s", (user,)).fetchone()[
                "email"
            ]
            == target
        )


def test_expired_wrong_purpose_and_weak_reset_requests_do_not_consume_a_valid_link(
    client, accounts
):
    users, _ = accounts
    user = users[0]
    expired = make_token(user, expired=True)
    assert (
        client.post(
            "/api/v1/auth/token",
            json={"kind": "reset", "token": expired, "password": NEW_PASSWORD},
        ).status_code
        == 400
    )
    token = make_token(user)
    assert (
        client.post(
            "/api/v1/auth/token", json={"kind": "email", "token": token}
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/v1/auth/token",
            json={"kind": "reset", "token": token, "password": "MotDePasse2026!"},
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/v1/auth/token",
            json={"kind": "reset", "token": token, "password": NEW_PASSWORD},
        ).status_code
        == 200
    )


def test_concurrent_redeem_is_single_use(client, accounts):
    import app

    users, _ = accounts
    token = make_token(users[0])
    barrier = Barrier(2)

    def redeem():
        http = app.app.test_client()
        barrier.wait(timeout=10)
        return http.post(
            "/api/v1/auth/token",
            json={"kind": "reset", "token": token, "password": NEW_PASSWORD},
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(lambda _: redeem(), range(2))) == [200, 400]


def test_presence_racing_logout_is_handled_without_a_foreign_key_error(
    client, accounts
):
    users, sign_in = accounts
    headers = sign_in(users[0])
    cookie = client.get_cookie("session").value
    import app

    beat_client = app.app.test_client()
    logout_client = app.app.test_client()
    beat_client.set_cookie("session", cookie)
    logout_client.set_cookie("session", cookie)
    barrier = Barrier(2)

    def beat():
        barrier.wait(timeout=10)
        return beat_client.post(
            "/api/v1/me/presence", headers=headers, json={"tab_id": "race"}
        ).status_code

    def logout():
        barrier.wait(timeout=10)
        return logout_client.post("/api/v1/auth/logout", headers=headers).status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(beat)
        second = executor.submit(logout)
        assert first.result(timeout=20) in (200, 401)
        assert second.result(timeout=20) == 200
    assert client.get("/api/v1/me").status_code == 401


def test_auth_rate_limit_is_enforced_and_recovers_after_window(client):
    import app

    for _ in range(30):
        assert (
            client.post(
                "/api/v1/auth/register", json={"username": "<script>"}
            ).status_code
            == 400
        )
    assert (
        client.post("/api/v1/auth/register", json={"username": "<script>"}).status_code
        == 429
    )
    with app.db() as conn:
        conn.execute(
            "UPDATE request_limits SET starts_at=now()-interval '16 minutes' WHERE key=%s",
            (client.environ_base["REMOTE_ADDR"],),
        )
    assert (
        client.post("/api/v1/auth/register", json={"username": "<script>"}).status_code
        == 400
    )


def test_simultaneous_email_claims_preserve_the_losing_accounts_address(
    client, accounts
):
    import app

    users, _ = accounts
    a, b, _ = users
    target = f"{secrets.token_hex(8)}@example.test"
    tokens = [
        make_token(a, "email", pending_email=target),
        make_token(b, "email", pending_email=target),
    ]
    with app.db() as conn:
        original = {
            row["id"]: row["email"]
            for row in conn.execute(
                "SELECT id,email FROM users WHERE id=ANY(%s)", ([a, b],)
            ).fetchall()
        }
    barrier = Barrier(2)

    def confirm(index):
        http = app.app.test_client()
        barrier.wait(timeout=10)
        return http.post(
            "/api/v1/auth/token", json={"kind": "email", "token": tokens[index]}
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        statuses = list(executor.map(confirm, range(2)))
    assert sorted(statuses) == [200, 409]
    with app.db() as conn:
        for index, user in enumerate([a, b]):
            email = conn.execute(
                "SELECT email FROM users WHERE id=%s", (user,)
            ).fetchone()["email"]
            assert email == (target if statuses[index] == 200 else original[user])


def test_login_cookie_is_http_only_and_csrf_belongs_to_its_session(client, accounts):
    import app

    users, sign_in = accounts
    user = users[0]
    with app.db() as conn:
        username = conn.execute(
            "UPDATE users SET password_hash=%s WHERE id=%s RETURNING username",
            (app.ph.hash(OLD_PASSWORD), user),
        ).fetchone()["username"]
    response = client.post(
        "/api/v1/auth/login", json={"username": username, "password": OLD_PASSWORD}
    )
    assert response.status_code == 200
    cookie = client.get_cookie("session")
    assert cookie.http_only and cookie.same_site == "Lax"
    csrf = response.json["csrf"]
    headers = sign_in(user)
    assert headers["X-CSRF-Token"] != csrf
    assert (
        client.post("/api/v1/auth/logout", headers={"X-CSRF-Token": csrf}).status_code
        == 403
    )
    assert client.get("/api/v1/me").status_code == 200
