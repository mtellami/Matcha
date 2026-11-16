"""Activity visibility and relationship state on disposable PostgreSQL."""

import os
import pytest

pytestmark = pytest.mark.skipif(
    not os.getenv("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL is required"
)


def test_sent_interest_tracks_matching_and_withdrawal(client, accounts):
    users, sign_in = accounts
    a, b, c = users
    headers = sign_in(a)
    assert client.post(f"/api/v1/profiles/{b}/like", headers=headers).status_code == 200
    activity = client.get("/api/v1/me/activity").json
    assert not activity["likes"]
    assert [person["actor"] for person in activity["sent"]] == [b]
    person = activity["sent"][0]
    assert person["first_name"] == "Test" and person["city"] == "Rabat"
    assert person["photo_id"] and not person["connected"]
    assert not {"email", "password_hash", "latitude", "longitude"} & person.keys()

    headers = sign_in(b)
    assert client.post(f"/api/v1/profiles/{a}/like", headers=headers).status_code == 200
    headers = sign_in(a)
    activity = client.get("/api/v1/me/activity").json
    assert activity["sent"][0]["connected"] and activity["likes"][0]["connected"]
    assert (
        client.delete(f"/api/v1/profiles/{b}/like", headers=headers).status_code == 200
    )
    activity = client.get("/api/v1/me/activity").json
    assert not activity["sent"] and not activity["likes"][0]["connected"]
    sign_in(c)
    activity = client.get("/api/v1/me/activity").json
    assert not activity["sent"] and not activity["likes"]


@pytest.mark.parametrize("blocked_by_viewer", [True, False])
def test_interest_lists_hide_blocked_and_unverified_profiles(
    client, accounts, blocked_by_viewer
):
    from app import db

    users, sign_in = accounts
    a, b, c = users
    with db() as conn:
        conn.execute(
            "INSERT INTO likes VALUES(%s,%s),(%s,%s),(%s,%s),(%s,%s)",
            (a, b, b, a, a, c, c, a),
        )
        conn.execute(
            "INSERT INTO blocks VALUES(%s,%s)", (a, b) if blocked_by_viewer else (b, a)
        )
        conn.execute("UPDATE users SET verified=false WHERE id=%s", (c,))
    sign_in(a)
    activity = client.get("/api/v1/me/activity").json
    assert not activity["sent"] and not activity["likes"]
