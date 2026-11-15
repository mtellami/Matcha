"""Decode uploads and produce a bounded, metadata-free JPEG."""

from io import BytesIO
import warnings
from PIL import Image, ImageOps, UnidentifiedImageError
from validation import ValidationError

MAX_BYTES = 8 * 1024 * 1024
MAX_PIXELS = 20_000_000
Image.MAX_IMAGE_PIXELS = MAX_PIXELS


def encode_photo(stream):
    contents = stream.read(MAX_BYTES + 1)
    if not contents or len(contents) > MAX_BYTES:
        raise ValidationError({"photo": "Choose an image smaller than 8 MB."})
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(contents)) as image:
                if image.format not in ("JPEG", "PNG", "WEBP"):
                    raise ValidationError({"photo": "Use JPEG, PNG, or WebP."})
                if image.width * image.height > MAX_PIXELS:
                    raise ValidationError(
                        {"photo": "Image must contain no more than 20 million pixels."}
                    )
                image.load()
                oriented = ImageOps.exif_transpose(image)
                oriented.thumbnail((1600, 1600))
                output = BytesIO()
                oriented.convert("RGB").save(output, "JPEG", quality=85)
                return output.getvalue()
    except ValidationError:
        raise
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        SyntaxError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ):
        raise ValidationError({"photo": "This file is not a valid image."}) from None
