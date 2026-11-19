"""Discovery data and mutual-interest responses on disposable PostgreSQL."""


def test_discovery_returns_ordered_photo_gallery_and_filters_names(client, accounts):
    from app import db

    users, sign_in = accounts
    a, b, c = users
    with db() as conn:
        conn.execute(
            "UPDATE users SET first_name='Yasmine',last_name='El Amrani' WHERE id=%s",
            (b,),
        )
        primary = conn.execute(
            "SELECT id FROM photos WHERE user_id=%s AND is_primary", (b,)
        ).fetchone()["id"]
        secondary = conn.execute(
            "INSERT INTO photos(user_id,filename,is_primary,position) VALUES(%s,%s,false,1) RETURNING id",
            (b, f"discovery-gallery-{b}.jpg"),
        ).fetchone()["id"]
    sign_in(a)
    response = client.get("/api/v1/profiles?q=Yasmine")
    assert response.status_code == 200
    assert response.json["total"] == 1
    person = response.json["profiles"][0]
    assert person["id"] == b and person["photo_id"] == primary
    assert person["photos"] == [
        {"id": primary, "is_primary": True},
        {"id": secondary, "is_primary": False},
    ]
    assert isinstance(person["online"], bool)
    assert client.get("/api/v1/profiles?q=yas").json["total"] == 0
    assert client.get("/api/v1/profiles?q=coffee").json["total"] == 0


def test_like_response_confirms_connection_only_when_mutual(client, accounts):
    users, sign_in = accounts
    a, b, _ = users
    response = client.post(f"/api/v1/profiles/{b}/like", headers=sign_in(a))
    assert response.status_code == 200
    assert response.json["connected"] is False
    response = client.post(f"/api/v1/profiles/{a}/like", headers=sign_in(b))
    assert response.status_code == 200
    assert response.json["connected"] is True
    response = client.delete(f"/api/v1/profiles/{b}/like", headers=sign_in(a))
    assert response.status_code == 200
    assert response.json["connected"] is False
