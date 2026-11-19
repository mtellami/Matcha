from types import SimpleNamespace

import pytest
import requests
from locations import search_locations, select_location
from validation import ValidationError


def feature(city="Bouskoura", identifier="place-one", longitude=-7.65, latitude=33.45):
    return {
        "properties": {
            "mapbox_id": identifier,
            "feature_type": "place",
            "name": city,
            "place_formatted": "Casablanca-Settat, Morocco",
            "context": {"country": {"name": "Morocco"}},
        },
        "geometry": {"coordinates": [longitude, latitude]},
    }


@pytest.fixture
def provider(monkeypatch):
    monkeypatch.setenv("VITE_MAPBOX_ACCESS_TOKEN", "pk.test")
    monkeypatch.delenv("MAPBOX_ACCESS_TOKEN", raising=False)
    calls = []

    def get(url, **kwargs):
        calls.append((url, kwargs))
        return SimpleNamespace(
            raise_for_status=lambda: None,
            json=lambda: {"features": [feature()]},
        )

    monkeypatch.setattr("locations.requests.get", get)
    return calls


def test_search_returns_dynamic_locations_outside_the_catalogue(provider):
    found = search_locations("Bousk")
    assert found[0] == {
        "id": "mapbox:place-one",
        "city": "Bouskoura",
        "country": "Morocco",
        "region": "Casablanca-Settat, Morocco",
        "latitude": 33.45,
        "longitude": -7.65,
    }
    assert provider[0][0].endswith("/forward")
    assert provider[0][1]["params"]["q"] == "Bousk"
    assert provider[0][1]["timeout"] == 5


def test_selected_mapbox_id_resolves_coordinates_on_the_server(provider):
    selected = select_location(
        {
            "location_source": "manual",
            "location_id": "mapbox:place-one",
            "city": "Forged",
            "latitude": 0,
            "longitude": 0,
        }
    )
    assert selected["city"] == "Bouskoura"
    assert selected["latitude"] == 33.45 and selected["longitude"] == -7.65
    assert provider[0][1]["params"]["q"] == "place-one"
    assert provider[0][1]["params"]["autocomplete"] == "false"


def test_unknown_provider_id_is_not_accepted(provider):
    with pytest.raises(ValidationError) as caught:
        select_location({"location_id": "mapbox:unknown"})
    assert "city" in caught.value.fields


def test_reverse_lookup_uses_gps_coordinates(provider):
    assert search_locations(latitude=33.45, longitude=-7.65)[0]["city"] == "Bouskoura"
    assert provider[0][0].endswith("/reverse")
    assert provider[0][1]["params"]["latitude"] == 33.45
    assert provider[0][1]["params"]["types"] == "place,locality"


def test_provider_outage_returns_retryable_city_error(provider, monkeypatch):
    def unavailable(*args, **kwargs):
        raise requests.Timeout("upstream unavailable")

    monkeypatch.setattr("locations.requests.get", unavailable)
    with pytest.raises(ValidationError) as caught:
        search_locations("Bousk")
    assert caught.value.status == 503 and "city" in caught.value.fields


def test_dynamic_city_can_be_searched_saved_and_reloaded(client, accounts, provider):
    users, sign_in = accounts
    headers = sign_in(users[0])
    assert client.get("/api/v1/locations?q=Bo").json == {"locations": []}
    assert not provider
    result = client.get("/api/v1/locations?q=Bousk")
    assert result.status_code == 200
    selected = result.json["locations"][0]
    response = client.patch(
        "/api/v1/me/profile",
        headers=headers,
        json={"location_source": "manual", "location_id": selected["id"]},
    )
    assert response.status_code == 200
    saved = client.get("/api/v1/me").json["user"]
    assert saved["city"] == "Bouskoura"
    assert saved["latitude"] == 33.45 and saved["longitude"] == -7.65
    for query in ["latitude=nan&longitude=0", "latitude=33", "q=" + "x" * 101]:
        assert client.get("/api/v1/locations?" + query).status_code == 400


def test_gps_city_names_are_not_restricted_to_the_old_catalogue_centers():
    selected = select_location(
        {
            "location_source": "gps",
            "city": "Paris",
            "latitude": 33.6609,
            "longitude": -95.5555,
        }
    )
    assert selected["city"] == "Paris"  # Paris, Texas, rather than Paris, France.
    assert selected["longitude"] == -95.5555
