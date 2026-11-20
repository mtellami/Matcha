import mimetypes
import secrets
from io import BytesIO

from flask import Blueprint, send_file
from werkzeug.utils import secure_filename
from app import (
    app,
    auth,
    blocked,
    connected,
    cursor,
    data,
    datetime,
    db,
    encode_photo,
    fail,
    g,
    jsonify,
    message_after,
    notify,
    pair_lock,
    request,
    storage,
    text,
    timedelta,
    timezone,
)

bp = Blueprint("conversations", __name__)
MAX_ATTACHMENT_SIZE = 8 * 1024 * 1024
ATTACHMENT_TYPES = {
    "photo": {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
    },
    "document": {
        # Documents are downloaded as attachments, so unknown types are safe
        # to store with an octet-stream fallback instead of being rendered.
    },
    "voice": {
        ".webm": "audio/webm",
        ".ogg": "audio/ogg",
        ".mp4": "audio/mp4",
        ".m4a": "audio/mp4",
        ".wav": "audio/wav",
        ".mp3": "audio/mpeg",
    },
}


def attachment_messages(rows):
    for row in rows:
        attachment_id = row.pop("attachment_id")
        attachment_name = row.pop("attachment_name")
        attachment_type = row.pop("attachment_type")
        attachment_kind = row.pop("attachment_kind")
        attachment_size = row.pop("attachment_size")
        if attachment_id is None:
            row["attachment"] = None
        else:
            row["attachment"] = {
                "id": attachment_id,
                "name": attachment_name,
                "content_type": attachment_type,
                "kind": attachment_kind,
                "size": attachment_size,
            }
    return rows


def message_select():
    return """SELECT m.*,a.id AS attachment_id,a.display_name AS attachment_name,
              a.content_type AS attachment_type,a.attachment_kind,
              a.size AS attachment_size
              FROM messages m LEFT JOIN message_attachments a ON a.message_id=m.id"""


def message_limit():
    raw_limit = request.args.get("limit")
    if raw_limit is None:
        return 50
    try:
        limit = int(raw_limit)
    except (ValueError, TypeError):
        fail("Invalid message page size", field="limit")
    if not 1 <= limit <= 50:
        fail("Message page size must be between 1 and 50", field="limit")
    return limit


def can_read_conversation(conn, uid):
    if blocked(conn, g.uid, uid):
        return False
    return (
        connected(conn, g.uid, uid)
        or conn.execute(
            "SELECT 1 FROM messages WHERE (actor=%s AND target=%s) OR (actor=%s AND target=%s) LIMIT 1",
            (g.uid, uid, uid, g.uid),
        ).fetchone()
        is not None
    )


@bp.route("/api/v1/conversations/<int:uid>/messages", methods=["GET", "POST"])
@auth
def messages(uid):
    with db() as conn:
        pair_lock(conn, g.uid, uid)
        is_connected = connected(conn, g.uid, uid)
        if request.method == "GET":
            if not can_read_conversation(conn, uid):
                fail("Conversation unavailable", 403)
            limit = message_limit()
            if "after" in request.args:
                if "before" in request.args:
                    fail("Choose either before or after, not both")
                try:
                    after = message_after(request.args["after"])
                except ValueError as exc:
                    fail(str(exc), field="after")
                rows = conn.execute(
                    message_select()
                    + " WHERE ((m.actor=%s AND m.target=%s) OR (m.actor=%s AND m.target=%s)) AND m.id>%s ORDER BY m.id ASC LIMIT %s",
                    (g.uid, uid, uid, g.uid, after, limit + 1),
                ).fetchall()
                return jsonify(
                    connected=is_connected,
                    messages=attachment_messages(rows[:limit]),
                    next_before=None,
                    next_after=rows[limit - 1]["id"] if len(rows) > limit else None,
                )
            rows = conn.execute(
                message_select()
                + " WHERE ((m.actor=%s AND m.target=%s) OR (m.actor=%s AND m.target=%s)) AND m.id<%s ORDER BY m.id DESC LIMIT %s",
                (g.uid, uid, uid, g.uid, cursor(), limit + 1),
            ).fetchall()
            return jsonify(
                connected=is_connected,
                messages=attachment_messages(rows[:limit][::-1]),
                next_before=rows[limit - 1]["id"] if len(rows) > limit else None,
                next_after=None,
            )
        if not is_connected:
            fail("A mutual connection is required", 403)
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


@bp.post("/api/v1/conversations/<int:uid>/attachments")
@auth
def send_attachment(uid):
    upload = request.files.get("attachment")
    if upload is None or not upload.filename:
        fail("Choose a file to attach", field="attachment")
    kind = request.form.get("attachment_kind", "")
    if kind not in ATTACHMENT_TYPES:
        fail("Choose a supported attachment type", field="attachment")
    filename = secure_filename(upload.filename)
    extension = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if not filename:
        fail("This file type is not supported", field="attachment")
    content_type = ATTACHMENT_TYPES[kind].get(extension)
    if kind == "document":
        content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    elif not content_type:
        fail("This file type is not supported", field="attachment")
    filename = filename[:255]
    if kind == "photo":
        contents = encode_photo(upload.stream)
        filename = filename.rsplit(".", 1)[0] + ".jpg"
        extension = ".jpg"
        content_type = "image/jpeg"
    else:
        contents = upload.stream.read(MAX_ATTACHMENT_SIZE + 1)
        if not contents:
            fail("The attachment is empty", field="attachment")
        if len(contents) > MAX_ATTACHMENT_SIZE:
            fail("Attachments must be 8 MB or smaller", field="attachment")

    body = request.form.get("body", "").strip()
    if len(body) > 4000:
        fail("Message must contain at most 4000 characters", field="body")
    if not body:
        body = (
            "Photo"
            if kind == "photo"
            else "Voice message"
            if kind == "voice"
            else filename
        )
    client_id = text(request.form.get("client_id"), "Message key", 100)
    object_key = secrets.token_hex(24) + extension

    with db() as conn:
        conn.execute(
            "INSERT INTO photo_deletions(filename,ready_at) VALUES(%s,now()+interval '1 hour')",
            (object_key,),
        )
    with db() as conn:
        pair_lock(conn, g.uid, uid)
        if not connected(conn, g.uid, uid):
            fail("A mutual connection is required", 403)
        message = conn.execute(
            "INSERT INTO messages(actor,target,body,client_id) VALUES(%s,%s,%s,%s) ON CONFLICT DO NOTHING RETURNING id",
            (g.uid, uid, body, client_id),
        ).fetchone()
        if not message:
            previous = conn.execute(
                "SELECT id,target,body FROM messages WHERE actor=%s AND client_id=%s",
                (g.uid, client_id),
            ).fetchone()
            if not previous or previous["target"] != uid or previous["body"] != body:
                fail("Message key was already used for different content", 409)
            attachment = conn.execute(
                "SELECT id FROM message_attachments WHERE message_id=%s",
                (previous["id"],),
            ).fetchone()
            if not attachment:
                fail("This message upload could not be resumed", 409)
            conn.execute("DELETE FROM photo_deletions WHERE filename=%s", (object_key,))
            return {"message": "Attachment sent"}, 201
        try:
            storage.put_object(object_key, contents, content_type)
        except Exception:
            app.logger.exception("Message attachment storage unavailable")
            fail(
                "Attachment storage is temporarily unavailable. Please try again.", 503
            )
        conn.execute(
            """INSERT INTO message_attachments
               (message_id,filename,display_name,content_type,attachment_kind,size)
               VALUES(%s,%s,%s,%s,%s,%s)""",
            (
                message["id"],
                object_key,
                filename[:255],
                content_type,
                kind,
                len(contents),
            ),
        )
        conn.execute("DELETE FROM photo_deletions WHERE filename=%s", (object_key,))
        notify(conn, g.uid, uid, "message")
    return {"message": "Attachment sent"}, 201


@bp.get("/api/v1/conversations/<int:uid>/messages/<int:message_id>/attachment")
@auth
def get_message_attachment(uid, message_id):
    with db() as conn:
        pair_lock(conn, g.uid, uid)
        if not can_read_conversation(conn, uid):
            fail("Conversation unavailable", 403)
        attachment = conn.execute(
            """SELECT a.filename,a.display_name,a.content_type,a.attachment_kind
               FROM message_attachments a JOIN messages m ON m.id=a.message_id
               WHERE m.id=%s AND ((m.actor=%s AND m.target=%s) OR (m.actor=%s AND m.target=%s))""",
            (cursor(message_id), g.uid, uid, uid, g.uid),
        ).fetchone()
        if not attachment:
            fail("Attachment unavailable", 404)
    try:
        contents = storage.get_object(attachment["filename"])
    except Exception:
        app.logger.exception("Message attachment could not be retrieved")
        fail("Attachment storage is temporarily unavailable. Please try again.", 503)
    inline = attachment["attachment_kind"] in ("photo", "voice")
    return send_file(
        BytesIO(contents),
        mimetype=attachment["content_type"],
        as_attachment=not inline,
        download_name=attachment["display_name"],
        max_age=0,
    )


@bp.route("/api/v1/conversations/<int:uid>/dates", methods=["GET", "POST"])
@auth
def date_events(uid):
    with db() as conn:
        pair_lock(conn, g.uid, uid)
        if not connected(conn, g.uid, uid):
            fail("A mutual connection is required", 403)
        if request.method == "GET":
            rows = conn.execute(
                """SELECT d.id,d.creator,d.invitee,d.title,d.location,d.details,
                   d.starts_at,d.status
                   FROM date_events d
                   WHERE (d.creator=%s AND d.invitee=%s)
                      OR (d.creator=%s AND d.invitee=%s)
                   ORDER BY CASE WHEN d.starts_at>=now() THEN 0 ELSE 1 END,
                            d.starts_at ASC
                   LIMIT 50""",
                (g.uid, uid, uid, g.uid),
            ).fetchall()
            for event in rows:
                event["starts_at"] = event["starts_at"].isoformat()
            return jsonify(events=rows)

        d = data()
        title = text(d.get("title"), "Plan title", 100, field="title")
        location = text(d.get("location"), "Meeting place", 160, field="location")
        details_value = d.get("details", "")
        if not isinstance(details_value, str) or len(details_value.strip()) > 500:
            fail("Details must contain at most 500 characters", field="details")
        starts_value = d.get("starts_at")
        try:
            starts_at = datetime.fromisoformat(starts_value.replace("Z", "+00:00"))
            if starts_at.tzinfo is None or starts_at.utcoffset() is None:
                raise ValueError()
            starts_at = starts_at.astimezone(timezone.utc)
            now = datetime.now(timezone.utc)
            if not now + timedelta(minutes=10) <= starts_at <= now + timedelta(days=90):
                raise ValueError()
        except (ValueError, AttributeError, TypeError):
            fail(
                "Choose a time at least 10 minutes from now and within the next 90 days.",
                field="starts_at",
            )
        event = conn.execute(
            """INSERT INTO date_events(creator,invitee,title,location,details,starts_at)
               VALUES(%s,%s,%s,%s,%s,%s)
               RETURNING id,creator,invitee,title,location,details,starts_at,status""",
            (g.uid, uid, title, location, details_value.strip(), starts_at),
        ).fetchone()
        event["starts_at"] = event["starts_at"].isoformat()
        notify(conn, g.uid, uid, "date_invite")
    return jsonify(event=event), 201


@bp.post("/api/v1/dates/<int:event_id>/rsvp")
@auth
def date_rsvp(event_id):
    response = data().get("response")
    if response not in ("accepted", "declined"):
        fail("Choose accept or decline", field="response")
    with db() as conn:
        event = conn.execute(
            "SELECT * FROM date_events WHERE id=%s FOR UPDATE", (event_id,)
        ).fetchone()
        if not event or event["invitee"] != g.uid:
            fail("Date invitation unavailable", 404)
        if event["status"] != "pending":
            fail("This invitation has already been answered", 409)
        if event["starts_at"] <= datetime.now(timezone.utc):
            fail("This invitation is in the past", 409)
        if not connected(conn, g.uid, event["creator"]):
            fail("A mutual connection is required", 403)
        conn.execute(
            "UPDATE date_events SET status=%s WHERE id=%s",
            (response, event_id),
        )
        notify(conn, g.uid, event["creator"], "date_response")
    return {"message": "Your response was sent"}


@bp.post("/api/v1/dates/<int:event_id>/cancel")
@auth
def cancel_date(event_id):
    with db() as conn:
        event = conn.execute(
            "SELECT * FROM date_events WHERE id=%s FOR UPDATE", (event_id,)
        ).fetchone()
        if not event or g.uid not in (event["creator"], event["invitee"]):
            fail("Date plan unavailable", 404)
        if event["status"] in ("declined", "cancelled"):
            fail("This plan is already closed", 409)
        conn.execute(
            "UPDATE date_events SET status='cancelled' WHERE id=%s", (event_id,)
        )
        other = event["invitee"] if event["creator"] == g.uid else event["creator"]
        notify(conn, g.uid, other, "date_response")
    return {"message": "Date plan cancelled"}


@bp.get("/api/v1/conversations")
@auth
def conversations():
    with db() as conn:
        rows = conn.execute(
            """SELECT (a.actor IS NOT NULL AND b.actor IS NOT NULL) AS connected,u.id,u.username,u.first_name,u.last_name,u.last_seen,
            EXISTS(SELECT 1 FROM presence p JOIN sessions s ON s.token=p.session_token
                   WHERE s.user_id=u.id AND s.expires_at>now() AND p.expires_at>now()) AS online,
            (SELECT id FROM photos WHERE user_id=u.id AND is_primary) AS photo_id,
            (SELECT body FROM messages WHERE (actor=%s AND target=u.id) OR (actor=u.id AND target=%s) ORDER BY id DESC LIMIT 1) AS preview,
            (SELECT max(id) FROM messages WHERE (actor=%s AND target=u.id) OR (actor=u.id AND target=%s)) AS last_message_id,
            (SELECT max(created_at) FROM messages WHERE (actor=%s AND target=u.id) OR (actor=u.id AND target=%s)) AS last_message_at,
            (SELECT count(*) FROM unnest(u.tags) AS common_tag(value)
             WHERE EXISTS (SELECT 1 FROM users own
               WHERE own.id=%s AND common_tag.value=ANY(own.tags))) AS common_tags,
            (SELECT max(created_at) FROM notifications WHERE actor=u.id AND target=%s AND kind='match') AS connected_at,
            (SELECT count(*) FROM messages WHERE actor=u.id AND target=%s AND NOT is_read) AS unread
            FROM users u LEFT JOIN likes a ON a.target=u.id AND a.actor=%s LEFT JOIN likes b ON b.actor=u.id AND b.target=%s
            WHERE NOT EXISTS(SELECT 1 FROM blocks WHERE (actor=%s AND target=u.id) OR (actor=u.id AND target=%s))
            AND ((a.actor IS NOT NULL AND b.actor IS NOT NULL)
              OR EXISTS(SELECT 1 FROM messages WHERE (actor=%s AND target=u.id) OR (actor=u.id AND target=%s)))
            ORDER BY last_message_id DESC NULLS LAST,u.id""",
            (g.uid,) * 15,
        ).fetchall()
    return jsonify(conversations=rows)


@bp.post("/api/v1/conversations/<int:uid>/read")
@auth
def read_messages(uid):
    through = cursor(data().get("through_id"))
    with db() as conn:
        pair_lock(conn, g.uid, uid)
        if not can_read_conversation(conn, uid):
            fail("Conversation unavailable", 403)
        conn.execute(
            "UPDATE messages SET is_read=true WHERE actor=%s AND target=%s AND id<=%s",
            (uid, g.uid, through),
        )
    return {"message": "Messages marked read"}
