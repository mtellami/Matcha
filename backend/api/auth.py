from flask import Blueprint
import app as services

from app import (
    DUMMY_HASH,
    InvalidHashError,
    OAUTH_PROVIDERS,
    OAuthAccountExists,
    OAuthError,
    OAuthSignInError,
    VerificationError,
    auth,
    create_login_session,
    data,
    db,
    digest,
    email_token,
    fail,
    g,
    jsonify,
    oauth,
    oauth_failure,
    oauth_name,
    oauth_redirect_uri,
    oauth_session,
    oauth_user,
    os,
    password,
    app,
    re,
    redirect,
    request,
    requests,
    set_login_cookie,
    text,
)

bp = Blueprint("auth", __name__)


@bp.post("/api/v1/auth/register")
def register():
    d = data()
    username = text(d.get("username"), "Username", 30)
    if not re.fullmatch(r"[a-zA-Z0-9_]{3,30}", username):
        fail("Use 3–30 letters, digits, or underscores", field="username")
    email = text(d.get("email"), "Email", 254).lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        fail("Enter a valid email", field="email")
    hashed = services.ph.hash(
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
    sent = services.deliver_account_message(message)
    return {
        "message": (
            "Check your email to verify your account"
            if sent
            else "Account created. Email is temporarily unavailable; use Resend verification email to try again."
        ),
        "verification_sent": sent,
    }, 201


@bp.post("/api/v1/auth/login")
def login():
    d = data()
    login_password = d.get("password")
    if not isinstance(login_password, str) or not 1 <= len(login_password) <= 128:
        fail("Invalid username or password", 401)
    with db() as conn:
        user = conn.execute(
            "SELECT * FROM users WHERE username=%s FOR UPDATE",
            (text(d.get("username"), "Username", 30).lower(),),
        ).fetchone()
        try:
            services.ph.verify(
                user["password_hash"] if user else DUMMY_HASH,
                login_password,
            )
        except (VerificationError, InvalidHashError):
            fail("Invalid username or password", 401)
        if not user:
            fail("Invalid username or password", 401)
        if not user["verified"]:
            fail("Verify your email before signing in", 403)
        token, csrf = create_login_session(conn, user["id"])
    response = jsonify(csrf=csrf)
    return set_login_cookie(response, token)


@bp.get("/api/v1/auth/providers")
def auth_providers():
    return {"providers": OAUTH_PROVIDERS}


@bp.get("/api/v1/auth/<provider>")
def oauth_start(provider):
    if provider not in OAUTH_PROVIDERS:
        fail("This sign-in provider is not configured", 404)
    client = oauth.create_client(provider)
    return client.authorize_redirect(oauth_redirect_uri(provider))


@bp.get("/api/v1/auth/<provider>/callback")
def oauth_callback(provider):
    if provider not in OAUTH_PROVIDERS:
        return oauth_failure("unavailable")
    client = oauth.create_client(provider)
    try:
        token = client.authorize_access_token()
        if provider == "google":
            profile = token.get("userinfo")
            email = profile.get("email") if isinstance(profile, dict) else None
            domain = email.rsplit("@", 1)[-1].lower() if isinstance(email, str) else ""
            trusted_domain = isinstance(profile, dict) and (
                domain == "gmail.com" or profile.get("hd") == domain
            )
            if (
                not isinstance(profile, dict)
                or profile.get("email_verified") is not True
                or not trusted_domain
            ):
                raise OAuthSignInError("Google did not verify this email")
            subject = profile.get("sub")
            first_name = profile.get("given_name") or profile.get("name")
            last_name = profile.get("family_name")
        else:
            response = client.get("user")
            response.raise_for_status()
            profile = response.json()
            if not isinstance(profile, dict):
                raise OAuthSignInError("GitHub did not return a usable profile")
            github_id = profile.get("id")
            subject = str(github_id) if isinstance(github_id, int) else ""
            email_response = client.get("user/emails")
            email_response.raise_for_status()
            email_data = email_response.json()
            if not isinstance(email_data, list):
                raise OAuthSignInError("GitHub did not return usable email data")
            verified_emails = [
                item
                for item in email_data
                if isinstance(item, dict) and item.get("verified") is True
            ]
            email_item = next(
                (item for item in verified_emails if item.get("primary")),
                verified_emails[0] if verified_emails else None,
            )
            if not email_item:
                raise OAuthSignInError("GitHub did not return a verified email")
            email = email_item.get("email")
            full_name = oauth_name(
                profile.get("name"), profile.get("login") or "Matcha member"
            )
            name_parts = full_name.split(maxsplit=1)
            first_name = name_parts[0] if name_parts else None
            last_name = name_parts[1] if len(name_parts) > 1 else None

        oauth_session.clear()
        user_id = oauth_user(provider, subject, email, first_name, last_name)
        with db() as conn:
            token_value, _ = create_login_session(conn, user_id)
        origin = os.getenv("APP_ORIGIN", "http://localhost:8080").rstrip("/")
        return set_login_cookie(redirect(f"{origin}/"), token_value)
    except OAuthAccountExists:
        oauth_session.clear()
        return oauth_failure("account_exists")
    except (
        OAuthError,
        requests.RequestException,
        OAuthSignInError,
        ValueError,
        KeyError,
        TypeError,
        AttributeError,
    ) as exc:
        oauth_session.clear()
        app.logger.info("OAuth sign-in failed (%s)", type(exc).__name__)
        return oauth_failure()


@bp.post("/api/v1/auth/reset-request")
def reset_request():
    d = data()
    with db() as conn:
        user = conn.execute(
            "SELECT * FROM users WHERE email=%s FOR UPDATE",
            (text(d.get("email"), "Email", 254).lower(),),
        ).fetchone()
        message = email_token(conn, user, "reset") if user else None
    if message:
        services.deliver_account_message(message)
    return {
        "message": "If the account exists, check your inbox for a reset link. You can request another link if it does not arrive."
    }


@bp.post("/api/v1/auth/token")
def redeem():
    d = data()
    kind = d.get("kind")
    if kind not in ("verify", "reset", "email"):
        fail("Invalid token purpose")
    hashed_token = digest(text(d.get("token"), "Token"))
    with db() as conn:
        candidate = conn.execute(
            """SELECT t.user_id,u.username,u.first_name,u.last_name,u.email FROM tokens t
            JOIN users u ON u.id=t.user_id WHERE t.token=%s AND t.kind=%s AND t.expires_at>clock_timestamp()""",
            (hashed_token, kind),
        ).fetchone()
        if not candidate:
            fail("Link expired or already used")
        new_hash = (
            services.ph.hash(
                password(
                    d.get("password"),
                    [
                        candidate["username"],
                        candidate["first_name"],
                        candidate["last_name"],
                        candidate["email"],
                    ],
                )
            )
            if kind == "reset"
            else None
        )
        services.lock_account(conn, candidate["user_id"])
        token = conn.execute(
            "DELETE FROM tokens WHERE token=%s AND kind=%s AND expires_at>clock_timestamp() RETURNING *",
            (hashed_token, kind),
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
                (new_hash, token["user_id"]),
            )
        if kind in ("reset", "email"):
            conn.execute("DELETE FROM tokens WHERE user_id=%s", (token["user_id"],))
            conn.execute("DELETE FROM sessions WHERE user_id=%s", (token["user_id"],))
        else:
            conn.execute(
                "DELETE FROM tokens WHERE user_id=%s AND kind='verify'",
                (token["user_id"],),
            )
    return {
        "message": {
            "verify": "Account verified",
            "email": "Email updated. Please sign in again.",
            "reset": "Password updated. Please sign in again.",
        }[kind]
    }


@bp.post("/api/v1/auth/logout")
@auth
def logout():
    with db() as conn:
        services.lock_account(conn, g.uid)
        conn.execute(
            "DELETE FROM sessions WHERE token=%s", (digest(request.cookies["session"]),)
        )
    response = jsonify(message="Signed out")
    response.delete_cookie("session")
    return response


@bp.post("/api/v1/me/email")
@auth
def change_email():
    new = text(data().get("email"), "Email", 254).lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", new):
        fail("Enter a valid email", field="email")
    with db() as conn:
        services.lock_account(conn, g.uid, g.session_token)
        if conn.execute("SELECT 1 FROM users WHERE email=%s", (new,)).fetchone():
            fail("Email unavailable", 409, field="email")
        message = email_token(conn, {"id": g.uid, "email": new}, "email")
        conn.execute(
            "UPDATE tokens SET pending_email=%s WHERE user_id=%s AND kind='email'",
            (new, g.uid),
        )
    if not services.deliver_account_message(message):
        fail(
            "Email is temporarily unavailable. Your current address is unchanged; try again shortly.",
            503,
        )
    return {"message": "Check your new email to confirm the change"}


@bp.post("/api/v1/auth/verification-request")
def verification_request():
    email = text(data().get("email"), "Email", 254).lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        fail("Enter a valid email", field="email")
    with db() as conn:
        user = conn.execute(
            "SELECT * FROM users WHERE email=%s AND NOT verified FOR UPDATE", (email,)
        ).fetchone()
        message = email_token(conn, user, "verify") if user else None
    if message:
        services.deliver_account_message(message)
    return {
        "message": "If your account needs verification, check your inbox for a new link. You can try again if it does not arrive."
    }
