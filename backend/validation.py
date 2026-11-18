"""Input validation without framework-bundled validators."""

from datetime import date
import math
import re
from domain import age_on


class ValidationError(ValueError):
    def __init__(self, fields, status=400):
        self.fields = fields
        self.status = status
        super().__init__("Please correct the highlighted fields.")


def profile_fields(data, partial=False):
    errors = {}
    result = {}
    for key, label, limit in [
        ("first_name", "First name", 80),
        ("last_name", "Last name", 80),
        ("city", "City or neighborhood", 100),
    ]:
        if partial and key not in data:
            continue
        value = data.get(key)
        if not isinstance(value, str) or not 1 <= len(value.strip()) <= limit:
            errors[key] = f"{label} must contain 1–{limit} characters."
        else:
            result[key] = value.strip()
    if not partial or "bio" in data:
        bio = data.get("bio")
        if not isinstance(bio, str) or len(bio.strip()) > 2000:
            errors["bio"] = "Biography must contain at most 2000 characters."
        else:
            result["bio"] = bio.strip()
    if not partial or "birth_date" in data:
        try:
            born = date.fromisoformat(data.get("birth_date", ""))
            if not 18 <= age_on(born, date.today()) <= 120:
                raise ValueError()
            result["birth_date"] = born
        except (ValueError, TypeError):
            errors["birth_date"] = (
                "Enter a valid date of birth; you must be at least 18."
            )
    for key, limit in [("latitude", 90), ("longitude", 180)]:
        if partial and key not in data:
            continue
        try:
            value = data.get(key)
            if isinstance(value, bool) or value is None:
                raise ValueError()
            value = float(value)
            if not math.isfinite(value) or not -limit <= value <= limit:
                raise ValueError()
            result[key] = round(value, 5)
        except (ValueError, TypeError):
            errors[key] = "Select a city or provide an approximate GPS location."
    genders = {"man", "woman", "nonbinary"}
    if not partial or "gender" in data:
        gender = data.get("gender")
        if not isinstance(gender, str) or gender not in genders:
            errors["gender"] = "Select a gender."
        else:
            result["gender"] = gender
    if not partial or "preferences" in data:
        preferences = data.get("preferences")
        if preferences is None or preferences == []:
            preferences = ["man", "woman"]
        if not isinstance(preferences, list) or not all(
            isinstance(p, str) and p in genders for p in preferences
        ):
            errors["preferences"] = "Choose valid gender preferences."
        else:
            result["preferences"] = list(dict.fromkeys(preferences))
    if not partial or "map_visible" in data:
        map_visible = data.get("map_visible")
        invalid_map_value = (
            not isinstance(map_visible, bool)
            if partial
            else map_visible is not None and not isinstance(map_visible, bool)
        )
        if invalid_map_value:
            errors["map_visible"] = "Choose whether to share your map location."
        else:
            result["map_visible"] = map_visible
    if not partial or "tags" in data:
        tags = data.get("tags")
        if (
            not isinstance(tags, list)
            or not 1 <= len(tags) <= 20
            or not all(
                isinstance(t, str) and re.fullmatch(r"[\w-]{1,30}", t) for t in tags
            )
        ):
            errors["tags"] = (
                "Choose 1–20 interests using letters, numbers, underscores, or hyphens."
            )
        else:
            result["tags"] = sorted(set(t.casefold() for t in tags))
    if errors:
        raise ValidationError(errors)
    return result
