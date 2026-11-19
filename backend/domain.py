"""Pure matching rules, shared by discovery and profile responses."""

from dataclasses import dataclass
import math
import re
from datetime import date


def age_on(born: date, today: date) -> int:
    return today.year - born.year - ((today.month, today.day) < (born.month, born.day))


def fame_rating(incoming_likes: int) -> int:
    if incoming_likes < 0:
        raise ValueError("Like count cannot be negative")
    return round(100 * incoming_likes / (incoming_likes + 10))


def distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    values = (lat1, lon1, lat2, lon2)
    if (
        not all(math.isfinite(v) for v in values)
        or not all(-90 <= v <= 90 for v in (lat1, lat2))
        or not all(-180 <= v <= 180 for v in (lon1, lon2))
    ):
        raise ValueError("Invalid coordinates")
    a = (
        math.sin(math.radians(lat1 - lat2) / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(math.radians(lon1 - lon2) / 2) ** 2
    )
    return round(6371 * 2 * math.asin(math.sqrt(min(1, a))), 1)


@dataclass(frozen=True)
class SearchFilters:
    min_age: int = 18
    max_age: int = 120
    radius: float = 20040
    min_fame: int = 0
    max_fame: int = 100
    min_common_tags: int = 0
    city: str = ""
    query: str = ""
    tags: tuple[str, ...] = ()
    sort: str = "suggested"
    direction: str = "asc"
    page: int = 1

    @classmethod
    def parse(cls, args):
        try:
            values = cls(
                min_age=int(args.get("min_age", 18)),
                max_age=int(args.get("max_age", 120)),
                radius=float(args.get("radius", 20040)),
                min_fame=int(args.get("min_fame", 0)),
                max_fame=int(args.get("max_fame", 100)),
                min_common_tags=int(args.get("min_common_tags", 0)),
                city=args.get("city", "").strip(),
                query=" ".join(args.get("q", "").split()),
                tags=tuple(
                    sorted(
                        set(
                            t.strip().lower().removeprefix("#")
                            for t in args.get("tags", "").split(",")
                            if t.strip()
                        )
                    )
                ),
                sort=args.get("sort", "suggested"),
                direction=args.get("direction", "asc"),
                page=int(args.get("page", 1)),
            )
        except (ValueError, TypeError, AttributeError):
            raise ValueError("Invalid search filters") from None
        if not 18 <= values.min_age <= values.max_age <= 120:
            raise ValueError("Age range must be between 18 and 120")
        if not 0 <= values.min_fame <= values.max_fame <= 100:
            raise ValueError("Fame range must be between 0 and 100")
        if not math.isfinite(values.radius) or not 0 <= values.radius <= 20040:
            raise ValueError("Distance must be between 0 and 20040 km")
        if (
            not 0 <= values.min_common_tags <= 20
            or len(values.city) > 100
            or len(values.query) > 200
            or values.page < 1
        ):
            raise ValueError("Invalid search filters")
        if len(values.tags) > 20 or not all(
            re.fullmatch(r"[\w-]{1,30}", t) for t in values.tags
        ):
            raise ValueError("Use up to 20 valid interest tags")
        if values.sort not in (
            "suggested",
            "age",
            "distance",
            "fame",
            "common_tags",
        ) or values.direction not in ("asc", "desc"):
            raise ValueError("Invalid sorting options")
        return values

    def accepts(self, candidate):
        first_name = " ".join(candidate.get("first_name", "").split()).casefold()
        last_name = " ".join(candidate.get("last_name", "").split()).casefold()
        username = candidate.get("username", "").casefold()
        query = self.query.casefold()
        if query.startswith("@"):
            matches_name = query[1:] == username
        else:
            matches_name = query in {
                first_name,
                last_name,
                f"{first_name} {last_name}".strip(),
                username,
            }
        return (
            (not query or matches_name)
            and self.min_age <= candidate["age"] <= self.max_age
            and self.min_fame <= candidate["fame"] <= self.max_fame
            and candidate["distance"] <= self.radius
            and candidate["common_tags"] >= self.min_common_tags
            and set(self.tags) <= set(candidate["tags"])
            and (not self.city or self.city.casefold() == candidate["city"].casefold())
        )


def page_cursor(value):
    if value is None or value == "":
        return 9223372036854775807
    try:
        number = int(value)
    except (ValueError, TypeError):
        raise ValueError("Invalid history cursor") from None
    if not 1 <= number <= 9223372036854775807:
        raise ValueError("Invalid history cursor")
    return number


def message_after(value):
    try:
        if value is None or value == "" or isinstance(value, bool):
            raise ValueError()
        number = int(value)
        if isinstance(value, float) and value != number:
            raise ValueError()
    except (ValueError, TypeError):
        raise ValueError("Invalid message cursor") from None
    if not 0 <= number <= 9223372036854775807:
        raise ValueError("Invalid message cursor")
    return number
