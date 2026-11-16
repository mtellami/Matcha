from datetime import date
import pytest
from domain import (
    SearchFilters,
    age_on,
    distance_km,
    fame_rating,
    message_after,
    page_cursor,
)


def test_adult_birthday_boundary():
    born = date(2008, 11, 15)
    assert age_on(born, date(2026, 11, 14)) == 17
    assert age_on(born, date(2026, 11, 15)) == 18


def test_leap_birthday():
    assert age_on(date(2004, 2, 29), date(2026, 2, 28)) == 21
    assert age_on(date(2004, 2, 29), date(2026, 3, 1)) == 22


def test_fame_is_bounded_and_monotonic():
    scores = [fame_rating(n) for n in range(501)]
    assert scores == sorted(scores)
    assert (
        scores[0] == 0 and fame_rating(10) == 50 and all(0 <= v <= 100 for v in scores)
    )
    with pytest.raises(ValueError):
        fame_rating(-1)


def test_geographic_distance():
    assert distance_km(33.59, -7.62, 33.59, -7.62) == 0
    assert 80 < distance_km(33.59, -7.62, 34.02, -6.84) < 100
    assert distance_km(33.59, -7.62, 34.02, -6.84) == distance_km(
        34.02, -6.84, 33.59, -7.62
    )
    assert 19000 < distance_km(0, 0, 0, 180) < 21000


@pytest.mark.parametrize(
    "coords", [(float("nan"), 0, 0, 0), (91, 0, 0, 0), (0, 181, 0, 0)]
)
def test_invalid_locations(coords):
    with pytest.raises(ValueError):
        distance_km(*coords)


def test_search_filters_normalize_tags_and_location():
    filters = SearchFilters.parse(
        {"tags": " #Coffee, music,COFFEE ", "city": " Rabat "}
    )
    assert filters.tags == ("coffee", "music")
    assert filters.city == "Rabat"
    candidate = {
        "age": 28,
        "fame": 50,
        "distance": 12,
        "common_tags": 2,
        "tags": ["coffee", "music"],
        "city": "rabat",
    }
    assert filters.accepts(candidate)
    assert not filters.accepts({**candidate, "tags": ["coffee"]})


@pytest.mark.parametrize(
    "args",
    [
        {"min_age": "17"},
        {"min_age": "40", "max_age": "30"},
        {"max_age": "121"},
        {"min_age": "abc"},
        {"min_fame": "-1"},
        {"min_fame": "80", "max_fame": "50"},
        {"max_fame": "101"},
        {"radius": "nan"},
        {"radius": "inf"},
        {"radius": "-1"},
        {"radius": "20041"},
        {"page": "0"},
        {"page": "1.5"},
        {"sort": "id;DROP TABLE users"},
        {"direction": "sideways"},
        {"min_common_tags": "21"},
        {"tags": "<script>"},
        {"tags": ",".join("tag" + str(i) for i in range(21))},
        {"city": "x" * 101},
    ],
)
def test_search_rejects_invalid_or_hostile_filters(args):
    with pytest.raises(ValueError):
        SearchFilters.parse(args)


def test_combined_search_ranges_and_shared_tags():
    filters = SearchFilters.parse(
        {
            "min_age": "25",
            "max_age": "35",
            "min_fame": "20",
            "max_fame": "70",
            "radius": "50",
            "min_common_tags": "2",
        }
    )
    candidate = {
        "age": 25,
        "fame": 20,
        "distance": 50,
        "common_tags": 2,
        "tags": [],
        "city": "Rabat",
    }
    assert filters.accepts(candidate)
    for key, value in [
        ("age", 36),
        ("fame", 71),
        ("distance", 50.1),
        ("common_tags", 1),
    ]:
        assert not filters.accepts({**candidate, key: value})


def test_history_cursor_defaults_and_limits():
    assert page_cursor(None) == 9223372036854775807
    assert page_cursor("42") == 42
    for value in ["-1", "0", "abc", "1.5", "9223372036854775808", [], {}]:
        with pytest.raises(ValueError):
            page_cursor(value)


def test_message_after_cursor_allows_zero_and_non_contiguous_ids():
    assert message_after("0") == 0
    assert message_after("5021") == 5021
    for invalid in [None, "", True, -1, "nan", "1.5", 1.5, 9223372036854775808]:
        with pytest.raises(ValueError):
            message_after(invalid)
