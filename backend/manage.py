import sys
from datetime import date
from io import BytesIO
from pathlib import Path

import storage
from app import create_photo, db, pool
from argon2 import PasswordHasher
from PIL import Image, ImageDraw


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


def seed():
    password = PasswordHasher().hash("Demo!River8Cloud&2026")
    city = "Casablanca"
    latitude = 33.5731
    longitude = -7.5898
    with db() as conn:
        for i in range(1, 501):
            conn.execute(
                """INSERT INTO users(email,username,first_name,last_name,password_hash,verified,
              birth_date,gender,bio,city,latitude,longitude,tags,map_visible)
              VALUES (%s,%s,%s,%s,%s,true,%s,%s,%s,%s,%s,%s,%s,true) ON CONFLICT DO NOTHING""",
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
                    latitude,
                    longitude,
                    ["coffee", "music" if i % 2 else "hiking"],
                ),
            )
        conn.execute(
            """UPDATE users SET city=%s,latitude=%s,longitude=%s,map_visible=true
               WHERE username LIKE 'demo%%'""",
            (city, latitude, longitude),
        )
    for i in range(1, 501):
        with db() as conn:
            user = conn.execute(
                "SELECT id FROM users WHERE username=%s", (f"demo{i}",)
            ).fetchone()
            photos = conn.execute(
                "SELECT id,is_primary FROM photos WHERE user_id=%s ORDER BY position,id",
                (user["id"],),
            ).fetchall()
            if photos:
                primary = next(
                    (photo for photo in photos if photo["is_primary"]), photos[0]
                )
                conn.execute(
                    "UPDATE photos SET is_primary=false WHERE user_id=%s",
                    (user["id"],),
                )
                conn.execute(
                    "UPDATE photos SET position=position+1 WHERE user_id=%s AND id<>%s",
                    (user["id"], primary["id"]),
                )
                conn.execute(
                    "UPDATE photos SET is_primary=true,position=0 WHERE id=%s",
                    (primary["id"],),
                )
        if photos:
            continue
        image = Image.new(
            "RGB",
            (600, 600),
            [(187, 206, 172), (225, 201, 171), (176, 204, 197), (202, 190, 211)][i % 4],
        )
        draw = ImageDraw.Draw(image)
        draw.text((220, 260), f"ALEX {i}", fill="#344b38", font_size=40)
        output = BytesIO()
        image.save(output, "JPEG")
        create_photo(user["id"], output.getvalue(), only_if_empty=True)
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
    try:
        commands[sys.argv[1]]()
    finally:
        pool.close()
