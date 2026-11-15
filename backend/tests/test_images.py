from io import BytesIO
import struct
import zlib
from PIL import Image
import pytest
from images import encode_photo, MAX_BYTES
from validation import ValidationError


def picture(format="PNG", size=(16, 8), **options):
    stream = BytesIO()
    Image.new("RGB", size, "green").save(stream, format, **options)
    stream.seek(0)
    return stream


@pytest.mark.parametrize("format", ["JPEG", "PNG", "WEBP"])
def test_allowed_formats_become_jpeg(format):
    result = encode_photo(picture(format))
    with Image.open(BytesIO(result)) as image:
        image.verify()
        assert image.format == "JPEG" and image.size == (16, 8)


def test_output_is_resized_without_distorting_aspect_ratio():
    with Image.open(BytesIO(encode_photo(picture(size=(2000, 1000))))) as image:
        assert image.size == (1600, 800)


def test_exif_orientation_is_applied_and_metadata_is_removed():
    exif = Image.Exif()
    exif[274] = 6
    exif[315] = "Private author"
    exif[34853] = {1: "N", 2: (34, 0, 0)}
    with Image.open(
        BytesIO(encode_photo(picture("JPEG", (10, 20), exif=exif)))
    ) as image:
        assert image.size == (20, 10) and not image.getexif()


@pytest.mark.parametrize(
    "contents",
    [
        b"",
        b"not an image",
        b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        b"\xff\xd8\xffbroken",
        b"\x89PNG\r\n\x1a\nbroken",
    ],
)
def test_unauthorized_or_corrupted_contents_have_a_photo_error(contents):
    with pytest.raises(ValidationError) as caught:
        encode_photo(BytesIO(contents))
    assert "photo" in caught.value.fields


def test_gif_is_not_an_authorized_upload():
    with pytest.raises(ValidationError):
        encode_photo(picture("GIF"))


def test_oversized_content_is_rejected_before_decoding():
    with pytest.raises(ValidationError):
        encode_photo(BytesIO(b"x" * (MAX_BYTES + 1)))


def test_large_dimensions_are_rejected_before_allocating_pixel_memory():
    def chunk(name, body):
        return (
            struct.pack(">I", len(body))
            + name
            + body
            + struct.pack(">I", zlib.crc32(name + body) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", 5000, 5000, 8, 2, 0, 0, 0)
    contents = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(b"\x00"))
        + chunk(b"IEND", b"")
    )
    with pytest.raises(ValidationError):
        encode_photo(BytesIO(contents))
