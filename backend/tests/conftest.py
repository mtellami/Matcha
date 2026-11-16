import os
import secrets
import pytest


@pytest.fixture(scope="session", autouse=True)
def close_database_pool():
    yield
    # Stop workers before Python begins tearing down interpreter threads.
    import app

    app.pool.close()


@pytest.fixture
def client(monkeypatch):
    url = os.getenv("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL is required")
    monkeypatch.setenv("DATABASE_URL", url)
    from app import app, db as original_db

    app.config["TESTING"] = True
    address = f"198.18.{secrets.randbelow(256)}.{secrets.randbelow(254) + 1}"
    with app.test_client() as client:
        client.environ_base["REMOTE_ADDR"] = address
        yield client
    with original_db() as conn:
        conn.execute("DELETE FROM request_limits WHERE key=%s", (address,))


@pytest.fixture
def accounts(client):
    from app import db, digest

    suffix = secrets.token_hex(8)
    users = []
    with db() as conn:
        for number in range(3):
            user = conn.execute(
                """INSERT INTO users(email,username,first_name,last_name,password_hash,verified,
            birth_date,gender,preferences,bio,city,latitude,longitude,tags)
            VALUES(%s,%s,'Test','Account','not-a-login-hash',true,'1995-01-01','woman',ARRAY['woman'],'Testing profile','Rabat',34.02,-6.84,ARRAY['coffee']) RETURNING id""",
                (f"{suffix}-{number}@example.test", f"test{suffix}{number}"),
            ).fetchone()["id"]
            conn.execute(
                "INSERT INTO photos(user_id,filename,is_primary) VALUES(%s,%s,true)",
                (user, f"{suffix}-{number}.jpg"),
            )
            users.append(user)

    def sign_in(user):
        token = secrets.token_urlsafe(32)
        csrf = secrets.token_urlsafe(32)
        with db() as conn:
            conn.execute(
                "INSERT INTO sessions VALUES(%s,%s,%s,now()+interval '1 hour')",
                (digest(token), user, csrf),
            )
        client.set_cookie("session", token)
        return {"X-CSRF-Token": csrf}

    yield users, sign_in
    with db() as conn:
        names = [f"{suffix}-{number}.jpg" for number in range(3)]
        names.extend(
            row["filename"]
            for row in conn.execute(
                "SELECT filename FROM photos WHERE user_id=ANY(%s)", (users,)
            ).fetchall()
        )
        conn.execute("DELETE FROM photo_deletions WHERE filename=ANY(%s)", (names,))
        for table, columns in [
            ("notifications", ("actor", "target")),
            ("messages", ("actor", "target")),
            ("reports", ("actor", "target")),
            ("visits", ("actor", "target")),
            ("likes", ("actor", "target")),
            ("blocks", ("actor", "target")),
            ("muted_notifications", ("actor", "target")),
        ]:
            # Table/column names are fixed fixture constants, never request input.
            conn.execute(
                f"DELETE FROM {table} WHERE {columns[0]}=ANY(%s) OR {columns[1]}=ANY(%s)",
                (users, users),
            )
        conn.execute("DELETE FROM users WHERE id=ANY(%s)", (users,))
