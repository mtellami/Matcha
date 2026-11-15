import os
import secrets
import pytest

pytestmark = pytest.mark.skipif(
    not os.getenv("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL is required"
)


def test_registration_survives_smtp_outage_and_verification_can_be_resent(
    client, monkeypatch
):
    import app

    suffix = secrets.token_hex(6)
    email = f"{suffix}@example.test"
    username = "member" + suffix
    monkeypatch.setattr(app, "deliver_account_message", lambda message: False)
    try:
        response = client.post(
            "/api/v1/auth/register",
            json={
                "email": email,
                "username": username,
                "first_name": "Test",
                "last_name": "Account",
                "password": "RiverCloud!48&Lantern",
            },
        )
        assert (
            response.status_code == 201 and response.json["verification_sent"] is False
        )
        with app.db() as conn:
            user = conn.execute(
                "SELECT id,verified FROM users WHERE username=%s", (username,)
            ).fetchone()
            assert user and not user["verified"]
        delivered = []
        monkeypatch.setattr(
            app,
            "deliver_account_message",
            lambda message: delivered.append(message) or True,
        )
        assert (
            client.post(
                "/api/v1/auth/verification-request", json={"email": email}
            ).status_code
            == 200
        )
        assert len(delivered) == 1
        from urllib.parse import urlparse, parse_qs

        link = next(
            line
            for line in delivered[0].get_content().splitlines()
            if line.startswith("http")
        )
        token = parse_qs(urlparse(link).fragment)["token"][0]
        assert (
            client.post(
                "/api/v1/auth/token", json={"kind": "verify", "token": token}
            ).status_code
            == 200
        )
        assert (
            client.post(
                "/api/v1/auth/token", json={"kind": "verify", "token": token}
            ).status_code
            == 400
        )
    finally:
        with app.db() as conn:
            conn.execute("DELETE FROM users WHERE username=%s", (username,))


def test_unknown_and_verified_accounts_get_same_verification_response(
    client, accounts, monkeypatch
):
    import app

    users, sign_in = accounts
    sign_in(users[0])
    email = client.get("/api/v1/me").json["user"]["email"]

    def unexpected(_):
        raise AssertionError(
            "A verified or unknown account must not receive verification mail"
        )

    monkeypatch.setattr(app, "deliver_account_message", unexpected)
    known = client.post("/api/v1/auth/verification-request", json={"email": email})
    missing = client.post(
        "/api/v1/auth/verification-request",
        json={"email": "missing-" + secrets.token_hex(8) + "@example.test"},
    )
    assert (
        known.status_code == missing.status_code == 200 and known.json == missing.json
    )
