import sys
import random
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from io import BytesIO
from pathlib import Path

import requests
import storage
from app import create_photo, db, pool
from argon2 import PasswordHasher
from images import encode_photo


def migrate():
    root = Path(__file__).resolve().parent
    with db() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS migrations(name text PRIMARY KEY)")
        applied = {
            row["name"]
            for row in conn.execute("SELECT name FROM migrations").fetchall()
        }
        if "baseline" not in applied:
            conn.execute((root / "schema.sql").read_text())
            conn.execute("INSERT INTO migrations(name) VALUES (%s)", ("baseline",))
        if "photo_positions" not in applied:
            conn.execute(
                "ALTER TABLE photos ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0"
            )
            conn.execute("""
                WITH ranked AS (
                  SELECT id, row_number() OVER (
                    PARTITION BY user_id ORDER BY is_primary DESC, id
                  ) - 1 AS position
                  FROM photos
                )
                UPDATE photos p SET position=ranked.position
                FROM ranked WHERE p.id=ranked.id
            """)
            conn.execute(
                "CREATE INDEX IF NOT EXISTS photos_user_position ON photos (user_id, position, id)"
            )
            conn.execute(
                "INSERT INTO migrations(name) VALUES (%s)", ("photo_positions",)
            )
        if "message_attachments" not in applied:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS message_attachments (
                  id bigserial PRIMARY KEY,
                  message_id bigint NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
                  filename text NOT NULL UNIQUE,
                  display_name text NOT NULL,
                  content_type text NOT NULL,
                  attachment_kind text NOT NULL CHECK (attachment_kind IN ('photo', 'document', 'voice')),
                  size integer NOT NULL CHECK (size > 0),
                  created_at timestamptz NOT NULL DEFAULT now()
                )
            """)
            conn.execute(
                "INSERT INTO migrations(name) VALUES (%s)", ("message_attachments",)
            )
        if "map_visible_default" not in applied:
            conn.execute("ALTER TABLE users ALTER COLUMN map_visible SET DEFAULT true")
            conn.execute(
                "INSERT INTO migrations(name) VALUES (%s)", ("map_visible_default",)
            )


def seed():
    password = PasswordHasher().hash("Demo!River8Cloud&2026")
    count = 500
    cities = {
        "Casablanca": (33.5731, -7.5898),
        "Rabat": (34.0209, -6.8416),
        "Marrakech": (31.6295, -7.9811),
        "Fes": (34.0331, -5.0003),
        "Tangier": (35.7595, -5.8340),
    }
    tags = [
        ["coffee", "music"],
        ["hiking", "travel"],
        ["cooking", "films"],
        ["books", "art"],
        ["fitness", "nature"],
        ["technology", "coffee"],
    ]

    # Random User provides fictional test identities and portrait photos. Fetch
    # and validate everything before changing the database so a network failure
    # cannot leave a partially refreshed seed.
    response = requests.get(
        "https://randomuser.me/api/",
        params={
            "seed": "matcha-local-demo-2026",
            "results": count,
            "inc": "name,gender,picture",
            "noinfo": "",
        },
        timeout=30,
    )
    response.raise_for_status()
    people = response.json()["results"]
    if len(people) != count:
        raise RuntimeError(f"Expected {count} demo profiles, got {len(people)}")

    photo_urls = {person["picture"]["large"] for person in people}

    def download_photo(url):
        image_response = requests.get(url, timeout=20)
        image_response.raise_for_status()
        return url, encode_photo(BytesIO(image_response.content))

    with ThreadPoolExecutor(max_workers=12) as executor:
        photo_contents = dict(executor.map(download_photo, sorted(photo_urls)))

    today = date.today()
    rng = random.Random(2026)
    seeded_users = []
    with db() as conn:
        for i, person in enumerate(people, start=1):
            city = list(cities)[(i - 1) % len(cities)]
            center_lat, center_lon = cities[city]
            age = 20 + (i % 26)
            birth_date = today - timedelta(days=age * 365 + (i % 365))
            gender = "man" if person["gender"] == "male" else "woman"
            name = person["name"]
            user = conn.execute(
                """INSERT INTO users(email,username,first_name,last_name,password_hash,verified,
              birth_date,gender,preferences,bio,city,latitude,longitude,tags,map_visible)
              VALUES (%s,%s,%s,%s,%s,true,%s,%s,%s,%s,%s,%s,%s,%s,true)
              ON CONFLICT(username) DO UPDATE SET
                email=EXCLUDED.email,first_name=EXCLUDED.first_name,last_name=EXCLUDED.last_name,
                password_hash=EXCLUDED.password_hash,verified=true,birth_date=EXCLUDED.birth_date,
                gender=EXCLUDED.gender,preferences=EXCLUDED.preferences,bio=EXCLUDED.bio,
                city=EXCLUDED.city,latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,
                tags=EXCLUDED.tags,map_visible=true
              RETURNING id""",
                (
                    f"demo{i}@example.test",
                    f"demo{i}",
                    name["first"].title(),
                    name["last"].title(),
                    password,
                    birth_date,
                    gender,
                    ["man", "woman"],
                    "Here to meet people, find good coffee, and explore the city.",
                    city,
                    center_lat + rng.uniform(-0.025, 0.025),
                    center_lon + rng.uniform(-0.025, 0.025),
                    tags[(i - 1) % len(tags)],
                ),
            ).fetchone()
            seeded_users.append((user["id"], person["picture"]["large"]))

    for user_id, photo_url in seeded_users:
        with db() as conn:
            primary = conn.execute(
                "SELECT id,filename FROM photos WHERE user_id=%s AND is_primary",
                (user_id,),
            ).fetchone()
        if primary:
            storage.put_photo(primary["filename"], photo_contents[photo_url])
        else:
            create_photo(user_id, photo_contents[photo_url], only_if_empty=True)
    print(
        "Seeded 500 fictional demo profiles with portrait photos across "
        "Casablanca, Rabat, Marrakech, Fes, and Tangier. "
        "Login: demo1 / Demo!River8Cloud&2026"
    )


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
    try:
        commands[sys.argv[1]]()
    finally:
        pool.close()
