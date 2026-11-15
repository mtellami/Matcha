"""Database integration tests. Run after migrations with TEST_DATABASE_URL set."""

import os
import pytest

pytestmark = pytest.mark.skipif(
    not os.getenv("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL is required"
)


def test_session_required(client):
    assert client.get("/api/v1/me").status_code == 401
    assert client.get("/api/v1/profiles").status_code == 401
    assert client.get("/api/v1/notifications").status_code == 401


def test_untrusted_origin(client):
    response = client.post(
        "/api/v1/auth/login", json={}, headers={"Origin": "https://attacker.invalid"}
    )
    assert response.status_code == 403


def test_input_validation(client):
    assert (
        client.post("/api/v1/auth/register", json={"username": "<script>"}).status_code
        == 400
    )
    assert client.post("/api/v1/auth/register", json=[]).status_code == 400
    assert (
        client.post("/api/v1/auth/token", json={"kind": "invalid"}).status_code == 400
    )


def test_internal_error_hides_details(client, monkeypatch):
    import app

    def unavailable():
        raise RuntimeError("private database password")

    monkeypatch.setattr(app, "db", unavailable)
    response = client.get("/api/v1/health")
    assert response.status_code == 500
    assert b"private database password" not in response.data
