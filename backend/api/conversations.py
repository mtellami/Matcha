from flask import Blueprint
from app import (
    auth,
    connected,
    cursor,
    data,
    datetime,
    db,
    fail,
    g,
    jsonify,
    message_after,
    notify,
    pair_lock,
    request,
    text,
    timedelta,
    timezone,
)

bp = Blueprint("conversations", __name__)


@bp.route("/api/v1/conversations/<int:uid>/messages", methods=["GET", "POST"])
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
            """SELECT u.id,u.username,u.first_name,u.last_name,u.last_seen,
            EXISTS(SELECT 1 FROM presence p JOIN sessions s ON s.token=p.session_token
                   WHERE s.user_id=u.id AND s.expires_at>now() AND p.expires_at>now()) AS online,
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


@bp.post("/api/v1/conversations/<int:uid>/read")
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
