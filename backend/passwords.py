"""Local multilingual dictionary checks layered with zxcvbn strength estimation."""

from pathlib import Path
import unicodedata


def normalize(value):
    folded = unicodedata.normalize(
        "NFKD", unicodedata.normalize("NFKC", value).casefold()
    )
    return "".join(c for c in folded if not unicodedata.combining(c))


COMMON_WORDS = tuple(
    dict.fromkeys(
        normalize(word)
        for line in (Path(__file__).parent / "data/common_password_words.txt")
        .read_text(encoding="utf-8")
        .splitlines()
        if not line.startswith("#")
        for word in line.split()
    )
)


def dictionary_password(value):
    normalized = normalize(value)
    # Remove simple numeric/punctuation wrapping before interpreting leetspeak.
    while normalized and not normalized[0].isalpha():
        normalized = normalized[1:]
    while normalized and not normalized[-1].isalpha():
        normalized = normalized[:-1]
    normalized = normalized.translate(
        str.maketrans(
            {
                "0": "o",
                "1": "i",
                "3": "e",
                "4": "a",
                "5": "s",
                "7": "t",
                "@": "a",
                "$": "s",
            }
        )
    )
    core = "".join(c for c in normalized if c.isalpha())
    return any(
        core and len(core) % len(word) == 0 and core == word * (len(core) // len(word))
        for word in COMMON_WORDS
    )


def password_error(value, context=()):
    if not isinstance(value, str) or not 12 <= len(value) <= 128:
        return "Use 12–128 characters."
    if dictionary_password(value):
        return "Avoid common words, repeated words, and simple number substitutions."
    from zxcvbn import zxcvbn

    try:
        # Bound estimator cost; the full password is still hashed and verified.
        result = zxcvbn(
            value[:72],
            user_inputs=[
                *COMMON_WORDS,
                *(item for item in context if isinstance(item, str)),
            ],
        )
    except ValueError:
        return "Choose a different password of 12–128 characters."
    if result["score"] < 3:
        return "Choose a stronger password with several unrelated words or random characters."
    return None
