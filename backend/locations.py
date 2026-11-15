"""Curated, approximate city centers for offline manual location selection."""

import json
from pathlib import Path
from domain import distance_km
from validation import ValidationError

LOCATIONS = json.loads(
    (Path(__file__).parent / "data/locations.json").read_text(encoding="utf-8")
)


def select_location(data):
    result = dict(data)
    location_id = data.get("location_id")
    if data.get("location_source") == "manual" and location_id is None:
        raise ValidationError(
            {"city": "Choose a city from the suggestions, or use GPS."}
        )
    if location_id is not None:
        selected = next(
            (place for place in LOCATIONS if place["id"] == location_id), None
        )
        if not selected:
            raise ValidationError({"city": "Select a city from the list."})
        result.update({key: selected[key] for key in ("city", "latitude", "longitude")})
    elif isinstance(data.get("city"), str):
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
