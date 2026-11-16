from datetime import date
import pytest
from validation import ValidationError, profile_fields
from locations import LOCATIONS, select_location
from passwords import dictionary_password, password_error, COMMON_WORDS


def valid_profile():
    return {
        "first_name": " Alex ",
        "last_name": " Example ",
        "birth_date": "1995-01-01",
        "gender": "woman",
        "preferences": ["man", "woman"],
        "bio": " Coffee and conversation. ",
        "city": "Rabat",
        "latitude": 34.024,
        "longitude": -6.844,
        "tags": ["Coffee", "music", "coffee"],
    }


def test_profile_normalizes_fields_and_defaults_preferences():
    fields = profile_fields({**valid_profile(), "preferences": []})
    assert (
        fields["first_name"] == "Alex" and fields["bio"] == "Coffee and conversation."
    )
    assert fields["latitude"] == 34.024 and fields["longitude"] == -6.844
    assert fields["tags"] == ["coffee", "music"] and fields["preferences"] == [
        "man",
        "woman",
    ]
    assert fields["birth_date"] == date(1995, 1, 1)


def test_invalid_fields_are_reported_together():
    with pytest.raises(ValidationError) as caught:
        profile_fields(
            {
                "first_name": "",
                "last_name": 123,
                "birth_date": [],
                "gender": {},
                "preferences": [{}],
                "bio": "",
                "city": "",
                "latitude": float("nan"),
                "longitude": True,
                "tags": [],
            }
        )
    assert set(caught.value.fields) == {
        "first_name",
        "last_name",
        "birth_date",
        "gender",
        "preferences",
        "bio",
        "city",
        "latitude",
        "longitude",
        "tags",
    }
    assert str(caught.value) == "Please correct the highlighted fields."


@pytest.mark.parametrize(
    "change,field",
    [
        ({"birth_date": date.today().isoformat()}, "birth_date"),
        ({"birth_date": "1800-01-01"}, "birth_date"),
        ({"latitude": 91}, "latitude"),
        ({"longitude": -181}, "longitude"),
        ({"longitude": False}, "longitude"),
        ({"gender": []}, "gender"),
        ({"preferences": "man"}, "preferences"),
        ({"tags": ["<script>"]}, "tags"),
        ({"tags": ["x" * 31]}, "tags"),
        ({"bio": "a" * 2001}, "bio"),
    ],
)
def test_invalid_profile_values_have_field_errors(change, field):
    with pytest.raises(ValidationError) as caught:
        profile_fields({**valid_profile(), **change})
    assert field in caught.value.fields


def test_manual_city_selection_supplies_coordinates_without_client_coordinates():
    selected = select_location(
        {"location_source": "manual", "location_id": "marrakech"}
    )
    assert selected["city"] == "Marrakech" and selected["latitude"] == 31.63
    assert selected["longitude"] == -8


def test_missing_manual_selection_and_invalid_ids_report_city():
    for fields in [
        {"location_source": "manual"},
        {"location_id": "unknown"},
        {"location_id": {}},
    ]:
        with pytest.raises(ValidationError) as caught:
            select_location(fields)
        assert "city" in caught.value.fields


def test_gps_cannot_accidentally_keep_a_distant_city_label():
    with pytest.raises(ValidationError):
        select_location({"city": "Paris", "latitude": 33.59, "longitude": -7.62})
    assert (
        select_location({"city": "casablanca", "latitude": 33.6, "longitude": -7.63})[
            "city"
        ]
        == "Casablanca"
    )
    assert (
        select_location(
            {"city": "My neighborhood", "latitude": 33.6, "longitude": -7.63}
        )["city"]
        == "My neighborhood"
    )


def test_catalogue_is_unique_and_has_valid_approximate_centers():
    assert len(LOCATIONS) >= 30
    assert len({p["id"] for p in LOCATIONS}) == len(LOCATIONS)
    assert all(
        -90 <= p["latitude"] <= 90 and -180 <= p["longitude"] <= 180 for p in LOCATIONS
    )
    assert {"Morocco", "France", "Spain", "Canada"} <= {p["country"] for p in LOCATIONS}


@pytest.mark.parametrize(
    "value",
    [
        "P@ssw0rd2026!",
        "MotDePasse2026!",
        "Contraseña2026!",
        "Schmetterling2026!",
        "Wachtwoord2026!",
        "Bilgisayar2026!",
        "ПарольПароль",
        "كلمةالمرور2026!",
        "密码密码密码密码密码密码",
        "パスワードパスワードパスワード",
        "Anticonstitutionnellement",
        "Ｃｏｎｔｒａｓｅｎａ２０２６！",
    ],
)
def test_multilingual_dictionary_words_and_simple_variants_are_rejected(value):
    assert dictionary_password(value)
    assert password_error(value) is not None


def test_dictionary_check_does_not_reject_unrelated_passphrases():
    assert not dictionary_password("River-Cloud-Lantern-48!")
    assert not dictionary_password("Coffee+Nebula+Saturn+28")
    assert len(COMMON_WORDS) > 150


@pytest.mark.parametrize("value", [None, [], 123, "short", "x" * 129])
def test_password_length_and_type_errors_do_not_call_strength_estimator(value):
    assert password_error(value) == "Use 12–128 characters."


def test_strength_estimator_is_bounded_and_receives_multilingual_context(monkeypatch):
    import sys
    from types import SimpleNamespace

    calls = []

    def estimator(value, **kwargs):
        calls.append((value, kwargs))
        return {"score": 4}

    monkeypatch.setitem(sys.modules, "zxcvbn", SimpleNamespace(zxcvbn=estimator))
    value = "River-Cloud-Lantern-48!" + ("Varied-Content-37!" * 5)
    assert 72 < len(value) <= 128
    assert password_error(value, context=["Alex", None]) is None
    assert calls[0][0] == value[:72]
    assert (
        "contrasena" in calls[0][1]["user_inputs"]
        and "Alex" in calls[0][1]["user_inputs"]
    )
    assert None not in calls[0][1]["user_inputs"]
