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


def profile_fields(data):
    errors = {}
    result = {}
    for key, label, limit in [
        ("first_name", "First name", 80),
        ("last_name", "Last name", 80),
        ("bio", "Biography", 2000),
        ("city", "City or neighborhood", 100),
    ]:
        value = data.get(key)
        if not isinstance(value, str) or not 1 <= len(value.strip()) <= limit:
            errors[key] = f"{label} must contain 1–{limit} characters."
        else:
            result[key] = value.strip()
    try:
        born = date.fromisoformat(data.get("birth_date", ""))
        if not 18 <= age_on(born, date.today()) <= 120:
            raise ValueError()
        result["birth_date"] = born
    except (ValueError, TypeError):
        errors["birth_date"] = "Enter a valid date of birth; you must be at least 18."
    for key, limit in [("latitude", 90), ("longitude", 180)]:
        try:
            value = data.get(key)
            if isinstance(value, bool) or value is None:
                raise ValueError()
            value = float(value)
            if not math.isfinite(value) or not -limit <= value <= limit:
                raise ValueError()
            result[key] = round(value, 2)
        except (ValueError, TypeError):
            errors[key] = "Select a city or provide an approximate GPS location."
    genders = {"man", "woman", "nonbinary"}
    gender = data.get("gender")
    if not isinstance(gender, str) or gender not in genders:
        errors["gender"] = "Select a gender."
    else:
        result["gender"] = gender
    preferences = data.get("preferences")
    if preferences is None or preferences == []:
        preferences = ["man", "woman"]
    if not isinstance(preferences, list) or not all(
        isinstance(p, str) and p in genders for p in preferences
    ):
        errors["preferences"] = "Choose valid gender preferences."
    else:
        result["preferences"] = list(dict.fromkeys(preferences))
    tags = data.get("tags")
    if (
        not isinstance(tags, list)
        or not 1 <= len(tags) <= 20
        or not all(isinstance(t, str) and re.fullmatch(r"[\w-]{1,30}", t) for t in tags)
    ):
        errors["tags"] = (
            "Choose 1–20 interests using letters, numbers, underscores, or hyphens."
        )
    else:
        result["tags"] = sorted(set(t.casefold() for t in tags))
    if errors:
        raise ValidationError(errors)
    return result
