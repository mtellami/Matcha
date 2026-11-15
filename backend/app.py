import hashlib
import os
import re
import secrets
import threading
import time
from datetime import date
from functools import wraps
from io import BytesIO

import storage
from mailer import account_message, deliver_account_message
from domain import (
    age_on,
    fame_rating,
    distance_km,
    SearchFilters,
    page_cursor,
    message_after,
)
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, InvalidHashError
from flask import Flask, g, jsonify, request, send_file
from flask_socketio import SocketIO, join_room, disconnect
from http import HTTPStatus
from PIL import Image, UnidentifiedImageError
from psycopg import errors
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from werkzeug.exceptions import HTTPException
from passwords import password_error
from validation import ValidationError, profile_fields
from locations import LOCATIONS, select_location

app = Flask(__name__)
if os.getenv("TRUST_PROXY", "false").lower() == "true":
    from werkzeug.middleware.proxy_fix import ProxyFix

    # Only enable behind the private Nginx upstream, which replaces this header.
    app.wsgi_app = ProxyFix(
        app.wsgi_app, x_for=1, x_proto=0, x_host=0, x_port=0, x_prefix=0
    )
app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024
pool = ConnectionPool(
    os.environ.get("DATABASE_URL", "postgresql://matcha:matcha@localhost/matcha"),
    kwargs={"row_factory": dict_row},
    open=False,
)
socketio = SocketIO(
    app,
    async_mode="threading",
    cors_allowed_origins=[os.getenv("APP_ORIGIN", "http://localhost:5173")],
)
ph = PasswordHasher()


def db():
    if pool.closed:
        pool.open()
    return pool.connection()


def fail(message, status=400, field=None):
    from werkzeug.exceptions import abort

    if field and status in (400, 409):
        raise ValidationError({field: message}, status=status)
    abort(status, description=message)


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def data():
    value = request.get_json(silent=True)
    if not isinstance(value, dict):
        fail("Expected a JSON object")
    return value


def text(value, name, maximum=200, minimum=1, field=None):
    if not isinstance(value, str) or not minimum <= len(value.strip()) <= maximum:
        fail(
            f"{name} must contain {minimum}–{maximum} characters",
            field=field or name.lower().replace(" ", "_"),
        )
    return value.strip()


def password(value, context=()):
    message = password_error(value, context)
    if message:
        raise ValidationError({"password": message})
    return value


def current_session():
    token = request.cookies.get("session", "")
    if not token:
        return None
    with db() as conn:
        return conn.execute(
            "SELECT * FROM sessions WHERE token=%s AND expires_at>now()",
            (digest(token),),
        ).fetchone()


def auth(fn):
    @wraps(fn)
    def inner(*args, **kwargs):
        session = current_session()
        if not session:
            fail("Please sign in", 401)
        g.uid = session["user_id"]
        g.session_token = session["token"]
        g.csrf = session["csrf"]
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            if not secrets.compare_digest(
                request.headers.get("X-CSRF-Token", ""), session["csrf"]
            ):
                fail("Invalid CSRF token", 403)
        return fn(*args, **kwargs)

    return inner


@app.errorhandler(Exception)
def handle_error(exc):
    if isinstance(exc, ValidationError):
        return (
            jsonify(
                error={
                    "code": "validation_error" if exc.status == 400 else "conflict",
                    "message": str(exc),
                    "fields": exc.fields,
                }
            ),
            exc.status,
        )
    if isinstance(exc, HTTPException):
        return (
            jsonify(
                error={
                    "code": HTTPStatus(exc.code).name.lower(),
                    "message": exc.description,
                }
            ),
            exc.code,
        )
    if isinstance(exc, errors.UniqueViolation):
        field = {"users_username_key": "username", "users_email_key": "email"}.get(
            exc.diag.constraint_name
        )
        error = {"code": "conflict", "message": "This value already exists"}
        if field:
            error["fields"] = {field: "This value is already in use."}
        return jsonify(error=error), 409
    app.logger.exception("Unhandled request error")
    return (
        jsonify(
            error={
                "code": "internal_error",
                "message": "Something went wrong. Please try again.",
            }
        ),
        500,
    )


def email_token(conn, user, kind):
    token = secrets.token_urlsafe(32)
    conn.execute("DELETE FROM tokens WHERE user_id=%s AND kind=%s", (user["id"], kind))
    conn.execute(
        "INSERT INTO tokens(token,user_id,kind,expires_at) VALUES(%s,%s,%s,now()+interval '1 hour')",
        (digest(token), user["id"], kind),
    )
    return account_message(
        user["email"], kind, token, os.getenv("APP_ORIGIN", "http://localhost:8080")
    )


@app.get("/api/v1/health")
def health():
    with db() as conn:
        conn.execute("SELECT 1")
    return {"status": "ok"}


@app.post("/api/v1/auth/register")
def register():
    d = data()
    username = text(d.get("username"), "Username", 30)
    if not re.fullmatch(r"[a-zA-Z0-9_]{3,30}", username):
        fail("Use 3–30 letters, digits, or underscores", field="username")
    email = text(d.get("email"), "Email", 254).lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        fail("Enter a valid email", field="email")
    hashed = ph.hash(
        password(
            d.get("password"),
            [
                d.get("username"),
                d.get("first_name"),
                d.get("last_name"),
                d.get("email"),
            ],
        )
    )
    with db() as conn:
        user = conn.execute(
            "INSERT INTO users(email,username,first_name,last_name,password_hash) VALUES(%s,%s,%s,%s,%s) RETURNING *",
            (
                email,
                username.lower(),
                text(d.get("first_name"), "First name", 80),
                text(d.get("last_name"), "Last name", 80),
                hashed,
            ),
        ).fetchone()
        message = email_token(conn, user, "verify")
    sent = deliver_account_message(message)
    return {
        "message": (
            "Check your email to verify your account"
            if sent
            else "Account created. Email is temporarily unavailable; use Resend verification email to try again."
        ),
        "verification_sent": sent,
    }, 201


@app.post("/api/v1/auth/login")
def login():
    d = data()
    login_password = d.get("password")
    if not isinstance(login_password, str) or not 1 <= len(login_password) <= 128:
        fail("Invalid username or password", 401)
    with db() as conn:
        user = conn.execute(
            "SELECT * FROM users WHERE username=%s",
            (text(d.get("username"), "Username", 30).lower(),),
        ).fetchone()
        try:
            ph.verify(
                user["password_hash"] if user else DUMMY_HASH,
                login_password,
            )
        except (VerificationError, InvalidHashError):
            fail("Invalid username or password", 401)
        if not user:
            fail("Invalid username or password", 401)
        if not user["verified"]:
            fail("Verify your email before signing in", 403)
        token = secrets.token_urlsafe(32)
        csrf = secrets.token_urlsafe(32)
        conn.execute(
            "INSERT INTO sessions VALUES(%s,%s,%s,now()+interval '7 days')",
            (digest(token), user["id"], csrf),
        )
    response = jsonify(csrf=csrf)
    response.set_cookie(
        "session",
        token,
        httponly=True,
        samesite="Lax",
        secure=os.getenv("COOKIE_SECURE") == "true",
        max_age=604800,
    )
    return response


DUMMY_HASH = ph.hash(secrets.token_urlsafe(32))


@app.post("/api/v1/auth/reset-request")
def reset_request():
    d = data()
    with db() as conn:
        user = conn.execute(
            "SELECT * FROM users WHERE email=%s",
            (text(d.get("email"), "Email", 254).lower(),),
        ).fetchone()
        message = email_token(conn, user, "reset") if user else None
    if message:
        deliver_account_message(message)
    return {
        "message": "If the account exists, check your inbox for a reset link. You can request another link if it does not arrive."
    }


@app.post("/api/v1/auth/token")
def redeem():
    d = data()
    kind = d.get("kind")
    if kind not in ("verify", "reset", "email"):
        fail("Invalid token purpose")
    with db() as conn:
        token = conn.execute(
            "DELETE FROM tokens WHERE token=%s AND kind=%s AND expires_at>now() RETURNING *",
            (digest(text(d.get("token"), "Token")), kind),
        ).fetchone()
        if not token:
            fail("Link expired or already used")
        if kind == "verify":
            conn.execute(
                "UPDATE users SET verified=true WHERE id=%s", (token["user_id"],)
            )
        elif kind == "email":
            conn.execute(
                "UPDATE users SET email=%s WHERE id=%s",
                (token["pending_email"], token["user_id"]),
            )
        else:
            conn.execute(
                "UPDATE users SET password_hash=%s WHERE id=%s",
                (ph.hash(password(d.get("password"))), token["user_id"]),
            )
            conn.execute("DELETE FROM sessions WHERE user_id=%s", (token["user_id"],))
    return {
        "message": {
            "verify": "Account verified",
            "email": "Email updated",
            "reset": "Password updated",
        }[kind]
    }


@app.post("/api/v1/auth/logout")
@auth
def logout():
    with db() as conn:
        conn.execute(
            "DELETE FROM sessions WHERE token=%s", (digest(request.cookies["session"]),)
        )
    response = jsonify(message="Signed out")
    response.delete_cookie("session")
    return response


@app.get("/api/v1/me")
@auth
def me():
    with db() as conn:
        user = conn.execute(
            "SELECT id,email,username,first_name,last_name,birth_date,gender,preferences,bio,city,latitude,longitude,tags FROM users WHERE id=%s",
            (g.uid,),
        ).fetchone()
        user["photos"] = conn.execute(
            "SELECT id,is_primary FROM photos WHERE user_id=%s ORDER BY is_primary DESC,id",
            (g.uid,),
        ).fetchall()
    if user["birth_date"]:
        user["birth_date"] = user["birth_date"].isoformat()
    return jsonify(user=user, csrf=g.csrf)


@app.put("/api/v1/me/profile")
@auth
def edit_profile():
    fields = profile_fields(select_location(data()))
    with db() as conn:
        conn.execute(
            "UPDATE users SET first_name=%s,last_name=%s,birth_date=%s,gender=%s,preferences=%s,bio=%s,city=%s,latitude=%s,longitude=%s,tags=%s WHERE id=%s",
            tuple(
                fields[key]
                for key in (
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
                )
            )
            + (g.uid,),
        )
    return {"message": "Profile saved"}


@app.post("/api/v1/me/photos")
@auth
def upload():
    file = request.files.get("photo")
    if not file:
        fail("Select an image", field="photo")
    try:
        Image.MAX_IMAGE_PIXELS = 20_000_000
        image = Image.open(file.stream)
        if image.format not in ("JPEG", "PNG", "WEBP"):
            fail("Use JPEG, PNG, or WebP", field="photo")
        if image.width * image.height > 20_000_000:
            fail("Image must contain no more than 20 million pixels")
        image.load()
        image.thumbnail((1600, 1600))
        output = BytesIO()
        image.convert("RGB").save(output, "JPEG", quality=85)
    except (
        UnidentifiedImageError,
        OSError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ):
        fail("Invalid image", field="photo")
    name = secrets.token_hex(24) + ".jpg"
    with db() as conn:
        conn.execute("SELECT id FROM users WHERE id=%s FOR UPDATE", (g.uid,))
        count = conn.execute(
            "SELECT count(*) AS n FROM photos WHERE user_id=%s", (g.uid,)
        ).fetchone()["n"]
        if count >= 5:
            fail("Maximum five photos", field="photo")
        storage.put_photo(name, output.getvalue())
        photo = conn.execute(
            "INSERT INTO photos(user_id,filename,is_primary) VALUES(%s,%s,%s) RETURNING id",
            (g.uid, name, count == 0),
        ).fetchone()
    return photo, 201


def blocked(conn, a, b):
    return conn.execute(
        "SELECT 1 FROM blocks WHERE (actor=%s AND target=%s) OR (actor=%s AND target=%s)",
        (a, b, b, a),
    ).fetchone()


def connected(conn, a, b):
    return (
        not blocked(conn, a, b)
        and conn.execute(
            "SELECT count(*) AS n FROM likes WHERE (actor=%s AND target=%s) OR (actor=%s AND target=%s)",
            (a, b, b, a),
        ).fetchone()["n"]
        == 2
    )


def pair_lock(conn, a, b):
    conn.execute(
        "SELECT id FROM users WHERE id IN (%s,%s) ORDER BY id FOR UPDATE", (a, b)
    )
    if a == b:
        fail("Choose another user")
    if not conn.execute("SELECT id FROM users WHERE id=%s", (b,)).fetchone():
        fail("Profile unavailable", 404)


def notify(conn, a, b, kind):
    if (
        not blocked(conn, a, b)
        and not conn.execute(
            "SELECT 1 FROM muted_notifications WHERE actor=%s AND target=%s", (a, b)
        ).fetchone()
    ):
        conn.execute(
            "INSERT INTO notifications(actor,target,kind) VALUES(%s,%s,%s)",
            (a, b, kind),
        )


@app.get("/api/v1/photos/<int:photo_id>")
@auth
def photo(photo_id):
    with db() as conn:
        p = conn.execute("SELECT * FROM photos WHERE id=%s", (photo_id,)).fetchone()
        if not p or blocked(conn, g.uid, p["user_id"]):
            fail("Image unavailable", 404)
    return send_file(
        BytesIO(storage.get_photo(p["filename"])),
        mimetype="image/jpeg",
        download_name="profile.jpg",
    )


@app.get("/api/v1/profiles")
@auth
def profiles():
    try:
        filters = SearchFilters.parse(request.args)
    except ValueError as exc:
        fail(str(exc))
    with db() as conn:
        own = conn.execute("SELECT * FROM users WHERE id=%s", (g.uid,)).fetchone()
        if (
            own["latitude"] is None
            or not own["gender"]
            or not own["birth_date"]
            or not own["bio"]
            or not own["tags"]
        ):
            fail("Complete your profile to discover people")
        rows = conn.execute(
            """SELECT u.id,u.username,u.first_name,u.last_name,u.birth_date,u.gender,u.bio,u.city,u.tags,
        u.latitude,u.longitude, (SELECT count(*) FROM likes WHERE target=u.id) AS likes,
        (SELECT id FROM photos WHERE user_id=u.id AND is_primary) AS photo_id
        FROM users u WHERE u.id<>%s AND u.verified AND u.gender=ANY(%s)
        AND %s=ANY(u.preferences) AND u.birth_date IS NOT NULL AND u.latitude IS NOT NULL AND u.bio<>''
        AND cardinality(u.tags)>0 AND NOT EXISTS(SELECT 1 FROM blocks WHERE
          (actor=%s AND target=u.id) OR (actor=u.id AND target=%s))""",
            (g.uid, own["preferences"], own["gender"], g.uid, g.uid),
        ).fetchall()
    today = date.today()
    result = []
    for u in rows:
        born = u.pop("birth_date")
        u["age"] = age_on(born, today)
        lat = u.pop("latitude")
        lon = u.pop("longitude")
        u["distance"] = distance_km(lat, lon, own["latitude"], own["longitude"])
        n = u.pop("likes")
        u["fame"] = fame_rating(n)
        u["common_tags"] = len(set(u["tags"]) & set(own["tags"]))
        if filters.accepts(u):
            result.append(u)
    key = filters.sort
    result.sort(
        key=lambda u: (
            (
                u["city"].casefold() != own["city"].casefold(),
                u["distance"],
                -u["common_tags"],
                -u["fame"],
                u["id"],
            )
            if key == "suggested"
            else (u[key], u["id"])
        ),
        reverse=filters.direction == "desc",
    )
    return jsonify(
        profiles=result[(filters.page - 1) * 24 : filters.page * 24],
        total=len(result),
        page=filters.page,
        page_size=24,
    )


@app.get("/api/v1/profiles/<int:uid>")
@auth
def profile(uid):
    with db() as conn:
        if uid != g.uid:
            pair_lock(conn, g.uid, uid)
        if blocked(conn, g.uid, uid):
            fail("Profile unavailable", 404)
        u = conn.execute(
            "SELECT id,username,first_name,last_name,birth_date,gender,preferences,bio,city,tags,last_seen FROM users WHERE id=%s AND verified",
            (uid,),
        ).fetchone()
        if not u:
            fail("Profile unavailable", 404)
        born = u.pop("birth_date")
        today = date.today()
        u["age"] = age_on(born, today) if born else None
        u["photos"] = conn.execute(
            "SELECT id,is_primary FROM photos WHERE user_id=%s ORDER BY is_primary DESC,id",
            (uid,),
        ).fetchall()
        n = conn.execute(
            "SELECT count(*) AS n FROM likes WHERE target=%s", (uid,)
        ).fetchone()["n"]
        u["fame"] = fame_rating(n)
        u["liked"] = bool(
            conn.execute(
                "SELECT 1 FROM likes WHERE actor=%s AND target=%s", (g.uid, uid)
            ).fetchone()
        )
        u["likes_you"] = bool(
            conn.execute(
                "SELECT 1 FROM likes WHERE actor=%s AND target=%s", (uid, g.uid)
            ).fetchone()
        )
        u["online"] = is_online(conn, uid)
        u["connected"] = connected(conn, g.uid, uid)
        if uid != g.uid:
            recent = conn.execute(
                "SELECT 1 FROM visits WHERE actor=%s AND target=%s AND created_at>now()-interval '30 minutes'",
                (g.uid, uid),
            ).fetchone()
            conn.execute("INSERT INTO visits(actor,target) VALUES(%s,%s)", (g.uid, uid))
            if not recent:
                notify(conn, g.uid, uid, "visit")
    return jsonify(u)


@app.route("/api/v1/profiles/<int:uid>/like", methods=["POST", "DELETE"])
@auth
def like(uid):
    with db() as conn:
        pair_lock(conn, g.uid, uid)
        if blocked(conn, g.uid, uid):
            fail("Profile unavailable", 404)
        if request.method == "DELETE":
            was = connected(conn, g.uid, uid)
            removed = conn.execute(
                "DELETE FROM likes WHERE actor=%s AND target=%s RETURNING actor",
                (g.uid, uid),
            ).fetchone()
            if was:
                notify(conn, g.uid, uid, "disconnect")
            if removed:
                conn.execute(
                    "INSERT INTO muted_notifications VALUES(%s,%s) ON CONFLICT DO NOTHING",
                    (uid, g.uid),
                )
        else:
            if not conn.execute(
                "SELECT 1 FROM photos WHERE user_id=%s AND is_primary", (g.uid,)
            ).fetchone():
                fail("Add a profile picture before liking")
            if not conn.execute(
                "SELECT 1 FROM photos WHERE user_id=%s AND is_primary", (uid,)
            ).fetchone():
                fail("This profile has no picture to like")
            conn.execute(
                "DELETE FROM muted_notifications WHERE actor=%s AND target=%s",
                (uid, g.uid),
            )
            inserted = conn.execute(
                "INSERT INTO likes VALUES(%s,%s) ON CONFLICT DO NOTHING RETURNING actor",
                (g.uid, uid),
            ).fetchone()
            if inserted:
                match = connected(conn, g.uid, uid)
                notify(conn, g.uid, uid, "match" if match else "like")
                if match:
                    notify(conn, uid, g.uid, "match")
    return {"message": "Relationship updated"}


@app.route("/api/v1/profiles/<int:uid>/block", methods=["POST", "DELETE"])
@auth
def block(uid):
    with db() as conn:
        pair_lock(conn, g.uid, uid)
        if request.method == "DELETE":
            conn.execute(
                "DELETE FROM blocks WHERE actor=%s AND target=%s", (g.uid, uid)
            )
        else:
            conn.execute(
                "INSERT INTO blocks VALUES(%s,%s) ON CONFLICT DO NOTHING", (g.uid, uid)
            )
            conn.execute(
                "DELETE FROM likes WHERE (actor=%s AND target=%s) OR (actor=%s AND target=%s)",
                (g.uid, uid, uid, g.uid),
            )
    return {"message": "Block updated"}


@app.post("/api/v1/profiles/<int:uid>/reports")
@auth
def report(uid):
    with db() as conn:
        pair_lock(conn, g.uid, uid)
        conn.execute(
            "INSERT INTO reports(actor,target,reason) VALUES(%s,%s,%s)",
            (
                g.uid,
                uid,
                text(data().get("reason", "Suspected fake account"), "Reason", 1000),
            ),
        )
    return {"message": "Report received"}, 201


@app.get("/api/v1/notifications")
@auth
def notifications():
    with db() as conn:
        rows = conn.execute(
            """SELECT n.*,u.username FROM notifications n JOIN users u ON u.id=n.actor
         WHERE n.target=%s AND NOT EXISTS(SELECT 1 FROM blocks b WHERE
         (b.actor=n.actor AND b.target=n.target) OR (b.target=n.actor AND b.actor=n.target))
         AND NOT EXISTS(SELECT 1 FROM muted_notifications m WHERE m.actor=n.actor AND m.target=n.target)
         AND n.id<%s ORDER BY n.id DESC LIMIT 51""",
            (g.uid, cursor()),
        ).fetchall()
    return jsonify(
        notifications=rows[:50], next_before=rows[49]["id"] if len(rows) > 50 else None
    )


@app.post("/api/v1/notifications/read")
@auth
def read_notifications():
    with db() as conn:
        through = cursor(data().get("through_id"))
        conn.execute(
            "UPDATE notifications SET is_read=true WHERE target=%s AND id<=%s",
            (g.uid, through),
        )
    return {"message": "Notifications marked read"}


@app.route("/api/v1/conversations/<int:uid>/messages", methods=["GET", "POST"])
@auth
def messages(uid):
    with db() as conn:
        pair_lock(conn, g.uid, uid)
        if not connected(conn, g.uid, uid):
            fail("A mutual connection is required", 403)
        if request.method == "GET":
            if "after" in request.args:
                if "before" in request.args:
                    fail("Choose either before or after, not both")
                try:
                    after = message_after(request.args["after"])
                except ValueError as exc:
                    fail(str(exc), field="after")
                rows = conn.execute(
                    "SELECT * FROM messages WHERE ((actor=%s AND target=%s) OR (actor=%s AND target=%s)) AND id>%s ORDER BY id ASC LIMIT 51",
                    (g.uid, uid, uid, g.uid, after),
                ).fetchall()
                return jsonify(
                    messages=rows[:50],
                    next_before=None,
                    next_after=rows[49]["id"] if len(rows) > 50 else None,
                )
            rows = conn.execute(
                "SELECT * FROM messages WHERE ((actor=%s AND target=%s) OR (actor=%s AND target=%s)) AND id<%s ORDER BY id DESC LIMIT 51",
                (g.uid, uid, uid, g.uid, cursor()),
            ).fetchall()
            return jsonify(
                messages=rows[:50][::-1],
                next_before=rows[49]["id"] if len(rows) > 50 else None,
                next_after=None,
            )
        d = data()
        body = text(d.get("body"), "Message", 4000, field="body")
        client_id = text(d.get("client_id"), "Message key", 100)
        msg = conn.execute(
            "INSERT INTO messages(actor,target,body,client_id) VALUES(%s,%s,%s,%s) ON CONFLICT DO NOTHING RETURNING *",
            (g.uid, uid, body, client_id),
        ).fetchone()
        if msg:
            notify(conn, g.uid, uid, "message")
        else:
            previous = conn.execute(
                "SELECT target,body FROM messages WHERE actor=%s AND client_id=%s",
                (g.uid, client_id),
            ).fetchone()
            if previous["target"] != uid or previous["body"] != body:
                fail("Message key was already used for different content", 409)
    return {"message": "Message sent"}, 201


@socketio.on("connect")
def socket_connect(auth_payload=None):
    session = current_session()
    if not session:
        return False
    join_room("session:" + session["token"])


@socketio.on("heartbeat")
def socket_heartbeat():
    if not current_session():
        socketio.emit("session_expired", to=request.sid)
        disconnect()
        return {"authenticated": False}
    return {"authenticated": True}


@app.route("/api/v1/me/photos/<int:photo_id>", methods=["PUT", "DELETE"])
@auth
def manage_photo(photo_id):
    with db() as conn:
        conn.execute("SELECT id FROM users WHERE id=%s FOR UPDATE", (g.uid,))
        photo = conn.execute(
            "SELECT * FROM photos WHERE id=%s AND user_id=%s", (photo_id, g.uid)
        ).fetchone()
        if not photo:
            fail("Photo unavailable", 404)
        if request.method == "DELETE":
            storage.delete_photo(photo["filename"])
            conn.execute("DELETE FROM photos WHERE id=%s", (photo_id,))
            if photo["is_primary"]:
                conn.execute(
                    "UPDATE photos SET is_primary=true WHERE id=(SELECT id FROM photos WHERE user_id=%s ORDER BY id LIMIT 1)",
                    (g.uid,),
                )
        else:
            conn.execute(
                "UPDATE photos SET is_primary=false WHERE user_id=%s", (g.uid,)
            )
            conn.execute("UPDATE photos SET is_primary=true WHERE id=%s", (photo_id,))
    return {"message": "Photos updated"}


@app.get("/api/v1/me/activity")
@auth
def activity():
    with db() as conn:
        visitors = conn.execute(
            """SELECT v.id,v.actor,u.username,v.created_at FROM visits v JOIN users u ON u.id=v.actor
            WHERE v.target=%s AND v.id<%s AND NOT EXISTS(SELECT 1 FROM blocks b
            WHERE (b.actor=v.actor AND b.target=v.target) OR (b.actor=v.target AND b.target=v.actor))
            ORDER BY v.id DESC LIMIT 51""",
            (g.uid, cursor()),
        ).fetchall()
        likes = conn.execute(
            "SELECT l.actor,u.username FROM likes l JOIN users u ON u.id=l.actor WHERE l.target=%s",
            (g.uid,),
        ).fetchall()
        blocks = conn.execute(
            "SELECT b.target AS actor,u.username FROM blocks b JOIN users u ON u.id=b.target WHERE b.actor=%s",
            (g.uid,),
        ).fetchall()
    return jsonify(
        visitors=visitors[:50],
        likes=likes,
        blocks=blocks,
        next_before=visitors[49]["id"] if len(visitors) > 50 else None,
    )


@app.post("/api/v1/me/email")
@auth
def change_email():
    new = text(data().get("email"), "Email", 254).lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", new):
        fail("Enter a valid email", field="email")
    with db() as conn:
        if conn.execute("SELECT 1 FROM users WHERE email=%s", (new,)).fetchone():
            fail("Email unavailable", 409, field="email")
        message = email_token(conn, {"id": g.uid, "email": new}, "email")
        conn.execute(
            "UPDATE tokens SET pending_email=%s WHERE user_id=%s AND kind='email'",
            (new, g.uid),
        )
    if not deliver_account_message(message):
        fail(
            "Email is temporarily unavailable. Your current address is unchanged; try again shortly.",
            503,
        )
    return {"message": "Check your new email to confirm the change"}


_delivery_lock = threading.Lock()
_delivery_started = False


def deliver_pending_events():
    with db() as conn:
        events = conn.execute(
            "SELECT * FROM notifications WHERE NOT delivered ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED"
        ).fetchall()
        for event in events:
            muted = conn.execute(
                "SELECT 1 FROM muted_notifications WHERE actor=%s AND target=%s",
                (event["actor"], event["target"]),
            ).fetchone()
            if not blocked(conn, event["actor"], event["target"]) and not muted:
                sessions = conn.execute(
                    "SELECT token FROM sessions WHERE user_id=%s AND expires_at>now() FOR SHARE",
                    (event["target"],),
                ).fetchall()
                for session in sessions:
                    socketio.emit(
                        "notification",
                        {
                            "id": event["id"],
                            "kind": event["kind"],
                            "actor": event["actor"],
                        },
                        to="session:" + session["token"],
                    )
            conn.execute(
                "UPDATE notifications SET delivered=true WHERE id=%s", (event["id"],)
            )


def deliver_events():
    while True:
        try:
            deliver_pending_events()
        except Exception:
            app.logger.exception("Notification delivery failed; retrying")
        time.sleep(1)


@app.before_request
def request_guards():
    global _delivery_started
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("Origin")
        if origin and origin != os.getenv("APP_ORIGIN", "http://localhost:5173"):
            fail("Untrusted origin", 403)
    if request.path.startswith("/api/v1/auth/") and request.method == "POST":
        key = request.remote_addr or "unknown"
        with db() as conn:
            count = conn.execute(
                """INSERT INTO request_limits(key,attempts) VALUES(%s,1)
            ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN request_limits.starts_at<now()-interval '15 minutes' THEN 1 ELSE request_limits.attempts+1 END,
            starts_at=CASE WHEN request_limits.starts_at<now()-interval '15 minutes' THEN now() ELSE request_limits.starts_at END RETURNING attempts""",
                (key,),
            ).fetchone()["attempts"]
        if count > 30:
            fail("Too many attempts. Try again in 15 minutes.", 429)
    if not _delivery_started and not app.testing:
        with _delivery_lock:
            if not _delivery_started:
                threading.Thread(target=deliver_events, daemon=True).start()
                _delivery_started = True


@app.after_request
def security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["Cache-Control"] = "no-store"
    return response


def cursor(value=None):
    try:
        return page_cursor(request.args.get("before") if value is None else value)
    except ValueError as exc:
        fail(str(exc))


def is_online(conn, uid):
    return bool(
        conn.execute(
            """SELECT 1 FROM presence p JOIN sessions s ON s.token=p.session_token
        WHERE s.user_id=%s AND s.expires_at>now() AND p.expires_at>now() LIMIT 1""",
            (uid,),
        ).fetchone()
    )


@app.route("/api/v1/me/presence", methods=["POST", "DELETE"])
@auth
def presence():
    tab = text(data().get("tab_id"), "Tab identifier", 100)
    with db() as conn:
        if request.method == "DELETE":
            conn.execute(
                "DELETE FROM presence WHERE session_token=%s AND tab_id=%s",
                (g.session_token, tab),
            )
        else:
            conn.execute("DELETE FROM presence WHERE expires_at<now()")
            conn.execute(
                "INSERT INTO presence VALUES(%s,%s,now()+interval '20 seconds') ON CONFLICT(session_token,tab_id) DO UPDATE SET expires_at=EXCLUDED.expires_at",
                (g.session_token, tab),
            )
            conn.execute("UPDATE users SET last_seen=now() WHERE id=%s", (g.uid,))
    return {"message": "Presence updated"}


@app.get("/api/v1/profiles/<int:uid>/status")
@auth
def profile_status(uid):
    with db() as conn:
        if blocked(conn, g.uid, uid):
            fail("Profile unavailable", 404)
        user = conn.execute(
            "SELECT last_seen FROM users WHERE id=%s AND verified", (uid,)
        ).fetchone()
        if not user:
            fail("Profile unavailable", 404)
        return jsonify(
            online=is_online(conn, uid),
            last_seen=user["last_seen"],
            connected=connected(conn, g.uid, uid),
            liked=bool(
                conn.execute(
                    "SELECT 1 FROM likes WHERE actor=%s AND target=%s", (g.uid, uid)
                ).fetchone()
            ),
            likes_you=bool(
                conn.execute(
                    "SELECT 1 FROM likes WHERE actor=%s AND target=%s", (uid, g.uid)
                ).fetchone()
            ),
        )


@app.get("/api/v1/conversations")
@auth
def conversations():
    with db() as conn:
        rows = conn.execute(
            """SELECT u.id,u.username,u.first_name,
            (SELECT id FROM photos WHERE user_id=u.id AND is_primary) AS photo_id,
            (SELECT body FROM messages WHERE (actor=%s AND target=u.id) OR (actor=u.id AND target=%s) ORDER BY id DESC LIMIT 1) AS preview,
            (SELECT max(id) FROM messages WHERE (actor=%s AND target=u.id) OR (actor=u.id AND target=%s)) AS last_message_id,
            (SELECT count(*) FROM messages WHERE actor=u.id AND target=%s AND NOT is_read) AS unread
            FROM users u JOIN likes a ON a.target=u.id AND a.actor=%s JOIN likes b ON b.actor=u.id AND b.target=%s
            WHERE NOT EXISTS(SELECT 1 FROM blocks WHERE (actor=%s AND target=u.id) OR (actor=u.id AND target=%s))
            ORDER BY last_message_id DESC NULLS LAST,u.id""",
            (g.uid,) * 9,
        ).fetchall()
    return jsonify(conversations=rows)


@app.post("/api/v1/conversations/<int:uid>/read")
@auth
def read_messages(uid):
    through = cursor(data().get("through_id"))
    with db() as conn:
        pair_lock(conn, g.uid, uid)
        if not connected(conn, g.uid, uid):
            fail("A mutual connection is required", 403)
        conn.execute(
            "UPDATE messages SET is_read=true WHERE actor=%s AND target=%s AND id<=%s",
            (uid, g.uid, through),
        )
    return {"message": "Messages marked read"}


@app.get("/api/v1/me/summary")
@auth
def summary():
    with db() as conn:
        notifications = conn.execute(
            """SELECT count(*) AS n FROM notifications n WHERE n.target=%s AND NOT n.is_read
        AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.actor=n.actor AND b.target=n.target) OR (b.actor=n.target AND b.target=n.actor))
        AND NOT EXISTS(SELECT 1 FROM muted_notifications m WHERE m.actor=n.actor AND m.target=n.target)""",
            (g.uid,),
        ).fetchone()["n"]
        messages = conn.execute(
            """SELECT count(*) AS n FROM messages m WHERE m.target=%s AND NOT m.is_read
        AND EXISTS(SELECT 1 FROM likes WHERE actor=m.actor AND target=m.target)
        AND EXISTS(SELECT 1 FROM likes WHERE target=m.actor AND actor=m.target)
        AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.actor=m.actor AND b.target=m.target) OR (b.actor=m.target AND b.target=m.actor))""",
            (g.uid,),
        ).fetchone()["n"]
    return jsonify(notifications=notifications, messages=messages)


@app.get("/api/v1/tags")
@auth
def tags():
    query = request.args.get("q", "").strip().lower()
    if len(query) > 30:
        fail("Tag search is too long")
    with db() as conn:
        rows = conn.execute(
            """SELECT DISTINCT tag FROM users u CROSS JOIN LATERAL unnest(u.tags) AS tag
            WHERE u.verified AND starts_with(tag,%s) ORDER BY tag LIMIT 30""",
            (query,),
        ).fetchall()
    return jsonify(tags=[r["tag"] for r in rows])


@app.get("/api/v1/locations")
@auth
def locations():
    query = request.args.get("q", "").strip().casefold()
    if len(query) > 100:
        fail("Location search is too long", field="city")
    return jsonify(
        locations=[
            place
            for place in LOCATIONS
            if not query or query in (place["city"] + " " + place["country"]).casefold()
        ]
    )


@app.post("/api/v1/auth/verification-request")
def verification_request():
    email = text(data().get("email"), "Email", 254).lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        fail("Enter a valid email", field="email")
    with db() as conn:
        user = conn.execute(
            "SELECT * FROM users WHERE email=%s AND NOT verified", (email,)
        ).fetchone()
        message = email_token(conn, user, "verify") if user else None
    if message:
        deliver_account_message(message)
    return {
        "message": "If your account needs verification, check your inbox for a new link. You can try again if it does not arrive."
    }
