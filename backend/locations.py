"""Mapbox city search and validation of selected profile locations."""

import json
import math
import os
from pathlib import Path

import requests
from domain import distance_km
from validation import ValidationError

LOCATIONS = json.loads(
    (Path(__file__).parent / "data/locations.json").read_text(encoding="utf-8")
)


def search_locations(query=None, *, latitude=None, longitude=None, exact=False):
    token = os.getenv("MAPBOX_ACCESS_TOKEN") or os.getenv("VITE_MAPBOX_ACCESS_TOKEN")
    if not token:
        raise ValidationError(
            {"city": "City search is unavailable. Please try again later."}, status=503
        )
    params = {
        "access_token": token,
        "types": "place,locality,neighborhood",
        "language": "en",
    }
    if query is not None:
        endpoint = "forward"
        params.update(q=query, autocomplete="false" if exact else "true", limit=5)
    else:
        endpoint = "reverse"
        params.update(latitude=latitude, longitude=longitude, types="place,locality")
    try:
        response = requests.get(
            f"https://api.mapbox.com/search/geocode/v6/{endpoint}",
            params=params,
            timeout=5,
        )
        response.raise_for_status()
        features = response.json()["features"]
        results = []
        for feature in features:
            properties = feature["properties"]
            if properties.get("feature_type") not in {
                "place",
                "locality",
                "neighborhood",
            }:
                continue
            lng, lat = feature["geometry"]["coordinates"][:2]
            if not (
                math.isfinite(lng)
                and math.isfinite(lat)
                and -180 <= lng <= 180
                and -90 <= lat <= 90
            ):
                continue
            name = properties.get("name_preferred") or properties["name"]
            results.append(
                {
                    "id": "mapbox:" + properties["mapbox_id"],
                    "city": name,
                    "country": properties.get("context", {})
                    .get("country", {})
                    .get("name", ""),
                    "region": properties.get("place_formatted", ""),
                    "latitude": lat,
                    "longitude": lng,
                }
            )
        return results
    except (requests.RequestException, ValueError, KeyError, TypeError):
        raise ValidationError(
            {"city": "City search is unavailable. Please retry or use GPS."}, status=503
        ) from None


def select_location(data):
    result = dict(data)
    location_id = data.get("location_id")
    if data.get("location_source") == "manual" and location_id is None:
        raise ValidationError(
            {"city": "Choose a city from the suggestions, or use GPS."}
        )
    if location_id is not None:
        if not isinstance(location_id, str) or len(location_id) > 512:
            raise ValidationError({"city": "Select a city from the suggestions."})
        if location_id.startswith("mapbox:"):
            selected = next(
                (
                    place
                    for place in search_locations(location_id[7:], exact=True)
                    if place["id"] == location_id
                ),
                None,
            )
        else:
            # Accept existing catalogue IDs for older clients and saved forms.
            selected = next(
                (place for place in LOCATIONS if place["id"] == location_id), None
            )
        if not selected:
            raise ValidationError({"city": "Select a city from the list."})
        result.update({key: selected[key] for key in ("city", "latitude", "longitude")})
    elif isinstance(data.get("city"), str) and data.get("location_source") != "gps":
        # Prevent an existing catalogue label accidentally staying attached to distant GPS coordinates.
        known = next(
            (
                place
                for place in LOCATIONS
                if place["city"].casefold() == data["city"].strip().casefold()
            ),
            None,
        )
        if known:
            try:
                distance = distance_km(
                    float(data["latitude"]),
                    float(data["longitude"]),
                    known["latitude"],
                    known["longitude"],
                )
            except (ValueError, TypeError, KeyError):
                return result  # General coordinate validator reports these fields.
            if distance > 100:
                raise ValidationError(
                    {
                        "city": "This city does not match your location. Choose the correct city or neighborhood."
                    }
                )
            result["city"] = known["city"]
    return result
