from contextlib import contextmanager
import os
import pytest

pytestmark = pytest.mark.skipif(
    not os.getenv("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL is required"
)


def test_storage_failure_does_not_prevent_logical_photo_removal(
    client, accounts, monkeypatch
):
    import app, storage

    users, sign_in = accounts
    headers = sign_in(users[0])
    photo = client.get("/api/v1/me").json["user"]["photos"][0]
    with app.db() as conn:
        name = conn.execute(
            "SELECT filename FROM photos WHERE id=%s", (photo["id"],)
        ).fetchone()["filename"]

    def unavailable(_):
        raise OSError("storage offline")

    monkeypatch.setattr(storage, "delete_photo", unavailable)
    assert (
        client.delete(f'/api/v1/me/photos/{photo["id"]}', headers=headers).status_code
        == 200
    )
    app.cleanup_pending_photos()
    with app.db() as conn:
        assert not conn.execute(
            "SELECT 1 FROM photos WHERE id=%s", (photo["id"],)
        ).fetchone()
        assert conn.execute(
            "SELECT 1 FROM photo_deletions WHERE filename=%s", (name,)
        ).fetchone()
    deleted = []
    monkeypatch.setattr(storage, "delete_photo", deleted.append)
    app.cleanup_pending_photos()
    assert name in deleted
    with app.db() as conn:
        assert not conn.execute(
            "SELECT 1 FROM photo_deletions WHERE filename=%s", (name,)
        ).fetchone()


def test_cleanup_never_deletes_a_referenced_photo(client, accounts, monkeypatch):
    import app, storage

    users, _ = accounts
    with app.db() as conn:
        name = conn.execute(
            "SELECT filename FROM photos WHERE user_id=%s", (users[0],)
        ).fetchone()["filename"]
        conn.execute("INSERT INTO photo_deletions(filename) VALUES(%s)", (name,))
    deleted = []
    monkeypatch.setattr(storage, "delete_photo", deleted.append)
    app.cleanup_pending_photos()
    assert name not in deleted


def test_failed_database_commit_leaves_an_unpublished_upload_for_cleanup(
    client, accounts, monkeypatch
):
    import app, storage

    users, _ = accounts
    original_db = app.db
    uploaded = []
    monkeypatch.setattr(
        storage, "put_photo", lambda name, contents: uploaded.append(name)
    )
    calls = 0

    @contextmanager
    def fail_publish():
        nonlocal calls
        calls += 1
        with original_db() as conn:
            yield conn
            if calls == 2:
                raise RuntimeError("simulated commit failure")

    monkeypatch.setattr(app, "db", fail_publish)
    with pytest.raises(RuntimeError):
        app.create_photo(users[0], b"test-content")
    monkeypatch.setattr(app, "db", original_db)
    assert len(uploaded) == 1
    with app.db() as conn:
        assert not conn.execute(
            "SELECT 1 FROM photos WHERE filename=%s", (uploaded[0],)
        ).fetchone()
        assert conn.execute(
            "SELECT 1 FROM photo_deletions WHERE filename=%s", (uploaded[0],)
        ).fetchone()
        conn.execute(
            "UPDATE photo_deletions SET ready_at=now() WHERE filename=%s",
            (uploaded[0],),
        )
    deleted = []
    monkeypatch.setattr(storage, "delete_photo", deleted.append)
    app.cleanup_pending_photos()
    assert uploaded[0] in deleted


def test_failed_upload_returns_retryable_error_and_keeps_current_photos(
    client, accounts, monkeypatch
):
    import storage
    from io import BytesIO
    from PIL import Image

    users, sign_in = accounts
    headers = sign_in(users[0])
    before = client.get("/api/v1/me").json["user"]["photos"]

    def unavailable(*args):
        raise OSError("storage offline")

    monkeypatch.setattr(storage, "put_photo", unavailable)
    contents = BytesIO()
    Image.new("RGB", (8, 8), "green").save(contents, "PNG")
    contents.seek(0)
    response = client.post(
        "/api/v1/me/photos", data={"photo": (contents, "photo.png")}, headers=headers
    )
    assert response.status_code == 503
    assert client.get("/api/v1/me").json["user"]["photos"] == before
