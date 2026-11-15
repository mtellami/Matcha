import sys
from io import BytesIO
import storage
from datetime import date
from pathlib import Path
from PIL import Image, ImageDraw
from argon2 import PasswordHasher
from app import db


def migrate():
    with db() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS migrations(name text PRIMARY KEY)")
        for path in sorted(
            (Path(__file__).resolve().parent / "migrations").glob("*.sql")
        ):
            if not conn.execute(
                "SELECT 1 FROM migrations WHERE name=%s", (path.name,)
            ).fetchone():
                conn.execute(path.read_text())
                conn.execute("INSERT INTO migrations VALUES (%s)", (path.name,))


def seed():
    password = PasswordHasher().hash("Demo!River8Cloud&2026")
    cities = [
        ("Casablanca", 33.59, -7.62),
        ("Rabat", 34.02, -6.84),
        ("Paris", 48.86, 2.35),
        ("London", 51.51, -0.13),
    ]
    with db() as conn:
        for i in range(1, 501):
            city, lat, lon = cities[i % 4]
            conn.execute(
                """INSERT INTO users(email,username,first_name,last_name,password_hash,verified,
              birth_date,gender,bio,city,latitude,longitude,tags)
              VALUES (%s,%s,%s,%s,%s,true,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING""",
                (
                    f"demo{i}@example.test",
                    f"demo{i}",
                    f"Alex {i}",
                    "Demo",
                    password,
                    date(1980 + i % 25, 1 + i % 12, 1 + i % 27),
                    "man" if i % 2 else "woman",
                    "Coffee, conversation, and discovering new places.",
                    city,
                    lat + (i % 10) * 0.001,
                    lon,
                    ["coffee", "music" if i % 2 else "hiking"],
                ),
            )
    with db() as conn:
        for i in range(1, 501):
            user = conn.execute(
                "SELECT id FROM users WHERE username=%s", (f"demo{i}",)
            ).fetchone()
            if not conn.execute(
                "SELECT 1 FROM photos WHERE user_id=%s", (user["id"],)
            ).fetchone():
                name = f"demo-{i}.jpg"
                image = Image.new(
                    "RGB",
                    (600, 600),
                    [
                        (187, 206, 172),
                        (225, 201, 171),
                        (176, 204, 197),
                        (202, 190, 211),
                    ][i % 4],
                )
                draw = ImageDraw.Draw(image)
                draw.text((220, 260), f"ALEX {i}", fill="#344b38", font_size=40)
                output = BytesIO()
                image.save(output, "JPEG")
                storage.put_photo(name, output.getvalue())
                conn.execute(
                    "INSERT INTO photos(user_id,filename,is_primary) VALUES(%s,%s,true)",
                    (user["id"], name),
                )
    print("Seeded 500 profiles. Login: demo1 / Demo!River8Cloud&2026")


def reports():
    import json

    with db() as conn:
        rows = conn.execute(
            "SELECT id,actor,target,reason,created_at FROM reports ORDER BY id DESC LIMIT 100"
        ).fetchall()
    print(json.dumps(rows, default=str, indent=2))


if __name__ == "__main__":
    commands = {
        "migrate": migrate,
        "seed": seed,
        "storage-init": storage.initialize,
        "reports": reports,
    }
    if len(sys.argv) != 2 or sys.argv[1] not in commands:
        raise SystemExit("Usage: python manage.py migrate|seed|storage-init|reports")
    commands[sys.argv[1]]()
