from datetime import date

from domain import age_on


def test_map_users_include_avatar_and_profile_card_fields_without_exposing_hidden_users(
    client, accounts
):
    from app import db

    users, sign_in = accounts
    sign_in(users[0])
    with db() as conn:
        assert conn.execute(
            "SELECT map_visible FROM users WHERE id=%s", (users[0],)
        ).fetchone()["map_visible"]
        conn.execute(
            "UPDATE users SET first_name='Sam',last_name='Rivera',map_visible=true WHERE id=%s",
            (users[1],),
        )
        conn.execute("UPDATE users SET map_visible=false WHERE id=%s", (users[2],))
    response = client.get("/api/v1/map/users")
    assert response.status_code == 200
    listed = {user["id"]: user for user in response.json["users"]}
    assert users[0] not in listed and users[2] not in listed
    person = listed[users[1]]
    assert person["first_name"] == "Sam" and person["last_name"] == "Rivera"
    assert person["gender"] == "woman"
    assert person["age"] == age_on(date(1995, 1, 1), date.today())
    assert isinstance(person["photo_id"], int)
    with db() as conn:
        conn.execute(
            "INSERT INTO blocks(actor,target) VALUES(%s,%s)", (users[0], users[1])
        )
    assert users[1] not in {
        user["id"] for user in client.get("/api/v1/map/users").json["users"]
    }
