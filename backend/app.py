import hashlib
import os
import re
import secrets
import threading
import time
from datetime import date, datetime, timezone, timedelta
from functools import cmp_to_key, wraps
from io import BytesIO

import storage
import requests
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
from flask import (
    Flask,
    g,
    jsonify,
    redirect,
    request,
    send_file,
    session as oauth_session,
)
from flask_socketio import SocketIO, join_room, disconnect
from authlib.integrations.flask_client import OAuth, OAuthError
from http import HTTPStatus
from images import encode_photo
from psycopg import errors
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from werkzeug.exceptions import HTTPException
from passwords import password_error
from validation import ValidationError, profile_fields
from locations import LOCATIONS, select_location

app = Flask(__name__)
oauth_state_secret = os.getenv("OAUTH_STATE_SECRET", "")
oauth_credentials = {
    "google": (
        os.getenv("GOOGLE_CLIENT_ID", ""),
        os.getenv("GOOGLE_CLIENT_SECRET", ""),
    ),
    "github": (
        os.getenv("GITHUB_CLIENT_ID", ""),
        os.getenv("GITHUB_CLIENT_SECRET", ""),
    ),
}
for provider, (client_id, client_secret) in oauth_credentials.items():
    if bool(client_id) != bool(client_secret):
        raise RuntimeError(f"Configure both {provider.upper()} OAuth credentials")
    if client_id and (
        not oauth_state_secret or oauth_state_secret.lower().startswith("replace-with-")
    ):
        raise RuntimeError("Set a private OAUTH_STATE_SECRET to enable OAuth")
app.secret_key = oauth_state_secret or secrets.token_urlsafe(48)
app.config.update(
    SESSION_COOKIE_NAME="matcha_oauth_state",
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.getenv("COOKIE_SECURE") == "true",
)
oauth = OAuth(app)
OAUTH_PROVIDERS = []
if oauth_credentials["google"][0]:
    oauth.register(
        name="google",
        client_id=oauth_credentials["google"][0],
        client_secret=oauth_credentials["google"][1],
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email profile"},
    )
    OAUTH_PROVIDERS.append("google")
if oauth_credentials["github"][0]:
    oauth.register(
        name="github",
        client_id=oauth_credentials["github"][0],
        client_secret=oauth_credentials["github"][1],
        authorize_url="https://github.com/login/oauth/authorize",
        access_token_url="https://github.com/login/oauth/access_token",
        api_base_url="https://api.github.com/",
        client_kwargs={"scope": "read:user user:email"},
    )
    OAUTH_PROVIDERS.append("github")
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
    cors_allowed_origins=[os.getenv("APP_ORIGIN", "http://localhost:8080")],
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


def lock_account(conn, user_id, session_token=None):
    # Credential changes and session/presence writes always lock the user first.
    user = conn.execute(
        "SELECT * FROM users WHERE id=%s FOR UPDATE", (user_id,)
    ).fetchone()
    if not user:
        fail("Please sign in", 401)
    if (
        session_token
        and not conn.execute(
            "SELECT 1 FROM sessions WHERE token=%s AND user_id=%s AND expires_at>clock_timestamp()",
            (session_token, user_id),
        ).fetchone()
    ):
        fail("Please sign in", 401)
    return user


def email_token(conn, user, kind):
    lock_account(conn, user["id"])
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


def create_login_session(conn, user_id):
    token = secrets.token_urlsafe(32)
    csrf = secrets.token_urlsafe(32)
    conn.execute(
        "INSERT INTO sessions VALUES(%s,%s,%s,now()+interval '7 days')",
        (digest(token), user_id, csrf),
    )
    return token, csrf


def set_login_cookie(response, token):
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


class OAuthAccountExists(Exception):
    pass


class OAuthSignInError(Exception):
    pass


def oauth_failure(reason="failed"):
    origin = os.getenv("APP_ORIGIN", "http://localhost:8080").rstrip("/")
    return redirect(f"{origin}/?oauth_error={reason}")


def oauth_redirect_uri(provider):
    origin = os.getenv("APP_ORIGIN", "http://localhost:8080").rstrip("/")
    return f"{origin}/api/v1/auth/{provider}/callback"


def oauth_name(value, fallback):
    return value.strip()[:80] if isinstance(value, str) and value.strip() else fallback


def oauth_user(provider, subject, email, first_name, last_name):
    if (
        not isinstance(subject, str)
        or not subject
        or len(subject) > 255
        or not isinstance(email, str)
    ):
        raise OAuthSignInError("Provider did not return a usable identity")
    email = email.strip().lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise OAuthSignInError("Provider did not return a verified email")

    with db() as conn:
        lock_keys = sorted((f"email:{email}", f"oauth:{provider}:{subject}"))
        for key in lock_keys:
            conn.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (key,)
            )
        existing = conn.execute(
            """SELECT u.id FROM oauth_identities i
               JOIN users u ON u.id=i.user_id
               WHERE i.provider=%s AND i.subject=%s FOR UPDATE OF u""",
            (provider, subject),
        ).fetchone()
        if existing:
            return existing["id"]

        if conn.execute("SELECT 1 FROM users WHERE email=%s", (email,)).fetchone():
            # Do not silently attach a new provider to an existing password account.
            raise OAuthAccountExists()

        first_name = oauth_name(first_name, "Matcha")
        last_name = oauth_name(last_name, "Member")
        base = re.sub(r"[^a-z0-9_]", "_", email.split("@", 1)[0].lower())
        base = base.strip("_")[:22]
        if len(base) < 3:
            base = "matcha"
        user = None
        for _ in range(20):
            username = f"{base}_{secrets.token_hex(3)}"
            user = conn.execute(
                """INSERT INTO users(email,username,first_name,last_name,password_hash,verified)
                   VALUES(%s,%s,%s,%s,%s,true)
                   ON CONFLICT(username) DO NOTHING RETURNING id""",
                (
                    email,
                    username,
                    first_name,
                    last_name,
                    ph.hash(secrets.token_urlsafe(48)),
                ),
            ).fetchone()
            if user:
                break
        if not user:
            raise OAuthSignInError("Could not create a Matcha account")
        conn.execute(
            "INSERT INTO oauth_identities(provider,subject,user_id) VALUES(%s,%s,%s)",
            (provider, subject, user["id"]),
        )
        return user["id"]


def create_photo(user_id, contents, only_if_empty=False):
    # Reserve cleanup before touching S3. Rollback/crash after upload leaves a retryable cleanup entry.
    name = secrets.token_hex(24) + ".jpg"
    with db() as conn:
        conn.execute(
            "INSERT INTO photo_deletions(filename,ready_at) VALUES(%s,now()+interval '1 hour')",
            (name,),
        )
    with db() as conn:
        conn.execute("SELECT id FROM users WHERE id=%s FOR UPDATE", (user_id,))
        count = conn.execute(
            "SELECT count(*) AS n FROM photos WHERE user_id=%s", (user_id,)
        ).fetchone()["n"]
        if only_if_empty and count:
            conn.execute("DELETE FROM photo_deletions WHERE filename=%s", (name,))
            return None
        if count >= 5:
            conn.execute("DELETE FROM photo_deletions WHERE filename=%s", (name,))
        else:
            photo = conn.execute(
                "INSERT INTO photos(user_id,filename,is_primary) VALUES(%s,%s,%s) RETURNING id",
                (user_id, name, count == 0),
            ).fetchone()
            try:
                storage.put_photo(name, contents)
            except Exception as exc:
                app.logger.warning("Photo upload unavailable (%s)", type(exc).__name__)
                fail("Photo storage is temporarily unavailable. Please try again.", 503)
            conn.execute("DELETE FROM photo_deletions WHERE filename=%s", (name,))
    if count >= 5:
        fail("Maximum five photos", field="photo")
    return photo


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


def cleanup_pending_photos():
    with db() as conn:
        pending = conn.execute(
            """SELECT d.filename FROM photo_deletions d WHERE d.ready_at<=now()
            AND NOT EXISTS(SELECT 1 FROM photos p WHERE p.filename=d.filename)
            ORDER BY d.ready_at LIMIT 20 FOR UPDATE OF d SKIP LOCKED"""
        ).fetchall()
        for photo in pending:
            try:
                storage.delete_photo(photo["filename"])
            except Exception as exc:
                app.logger.warning("Photo cleanup will retry (%s)", type(exc).__name__)
                continue
            conn.execute(
                "DELETE FROM photo_deletions WHERE filename=%s", (photo["filename"],)
            )


def cleanup_photos():
    while True:
        try:
            cleanup_pending_photos()
        except Exception:
            app.logger.exception("Photo cleanup will retry")
        time.sleep(30)


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
        if origin and origin != os.getenv("APP_ORIGIN", "http://localhost:8080"):
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
                threading.Thread(target=cleanup_photos, daemon=True).start()
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


__all__ = [
    "BytesIO",
    "DUMMY_HASH",
    "InvalidHashError",
    "LOCATIONS",
    "OAUTH_PROVIDERS",
    "OAuthAccountExists",
    "OAuthError",
    "OAuthSignInError",
    "SearchFilters",
    "VerificationError",
    "age_on",
    "auth",
    "blocked",
    "cmp_to_key",
    "connected",
    "create_login_session",
    "create_photo",
    "current_session",
    "cursor",
    "data",
    "date",
    "datetime",
    "db",
    "deliver_account_message",
    "digest",
    "disconnect",
    "distance_km",
    "email_token",
    "encode_photo",
    "fail",
    "fame_rating",
    "g",
    "is_online",
    "join_room",
    "jsonify",
    "lock_account",
    "message_after",
    "notify",
    "oauth",
    "oauth_failure",
    "oauth_name",
    "oauth_redirect_uri",
    "oauth_session",
    "oauth_user",
    "os",
    "pair_lock",
    "password",
    "ph",
    "profile_fields",
    "re",
    "redirect",
    "request",
    "requests",
    "secrets",
    "select_location",
    "send_file",
    "set_login_cookie",
    "socketio",
    "storage",
    "text",
    "timedelta",
    "timezone",
]

# Endpoint modules are imported after shared services are initialized.
from api.auth import bp as auth_bp  # noqa: E402
from api.profiles import bp as profiles_bp  # noqa: E402
from api.activity import bp as activity_bp  # noqa: E402
from api.conversations import bp as conversations_bp  # noqa: E402
from api import calls as _call_handlers  # noqa: E402, F401

app.register_blueprint(auth_bp)
app.register_blueprint(profiles_bp)
app.register_blueprint(activity_bp)
app.register_blueprint(conversations_bp)
