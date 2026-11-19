import math

from app import (
    auth,
    cursor,
    data,
    db,
    fail,
    g,
    jsonify,
    lock_account,
    request,
    text,
)
from flask import Blueprint
from locations import search_locations

bp = Blueprint("activity", __name__)


@bp.get("/api/v1/notifications")
@auth
def notifications():
    unread = request.args.get("unread", "false")
    if unread not in ("true", "false"):
        fail("Unread filter must be true or false")
    with db() as conn:
        rows = conn.execute(
            """SELECT n.*,u.username,u.first_name,u.last_name,
         (SELECT id FROM photos WHERE user_id=u.id AND is_primary) AS photo_id
         FROM notifications n JOIN users u ON u.id=n.actor
         WHERE n.target=%s AND NOT EXISTS(SELECT 1 FROM blocks b WHERE
         (b.actor=n.actor AND b.target=n.target) OR (b.target=n.actor AND b.actor=n.target))
         AND NOT EXISTS(SELECT 1 FROM muted_notifications m WHERE m.actor=n.actor AND m.target=n.target)
         AND (NOT %s OR NOT n.is_read)
         AND n.id<%s ORDER BY n.id DESC LIMIT 51""",
            (g.uid, unread == "true", cursor()),
        ).fetchall()
    return jsonify(
        notifications=rows[:50], next_before=rows[49]["id"] if len(rows) > 50 else None
    )


@bp.post("/api/v1/notifications/<int:notification_id>/read")
@auth
def read_notification(notification_id):
    notification_id = cursor(notification_id)
    with db() as conn:
        updated = conn.execute(
            "UPDATE notifications SET is_read=true WHERE id=%s AND target=%s RETURNING id",
            (notification_id, g.uid),
        ).fetchone()
        if not updated:
            fail("Notification unavailable", 404)
    return {"message": "Notification marked read"}


@bp.post("/api/v1/notifications/read")
@auth
def read_notifications():
    with db() as conn:
        through = cursor(data().get("through_id"))
        conn.execute(
            "UPDATE notifications SET is_read=true WHERE target=%s AND id<=%s",
            (g.uid, through),
        )
    return {"message": "Notifications marked read"}


@bp.get("/api/v1/me/activity")
@auth
def activity():
    with db() as conn:
        visitors = conn.execute(
            """SELECT v.id,v.actor,u.username,u.first_name,u.last_name,
            (SELECT id FROM photos WHERE user_id=u.id AND is_primary) AS photo_id,v.created_at
            FROM visits v JOIN users u ON u.id=v.actor
            WHERE v.target=%s AND v.id<%s AND NOT EXISTS(SELECT 1 FROM blocks b
            WHERE (b.actor=v.actor AND b.target=v.target) OR (b.actor=v.target AND b.target=v.actor))
            ORDER BY v.id DESC LIMIT 51""",
            (g.uid, cursor()),
        ).fetchall()
        relationships = conn.execute(
            """SELECT u.id AS actor,u.username,u.first_name,u.last_name,u.city,
            (SELECT id FROM photos WHERE user_id=u.id AND is_primary) AS photo_id,
            l.actor=%s AS sent,
            EXISTS(SELECT 1 FROM likes reciprocal
              WHERE reciprocal.actor=l.target AND reciprocal.target=l.actor) AS connected
            FROM likes l JOIN users u
              ON u.id=CASE WHEN l.actor=%s THEN l.target ELSE l.actor END
            WHERE (l.actor=%s OR l.target=%s) AND u.verified
            AND NOT EXISTS(SELECT 1 FROM blocks b WHERE
              (b.actor=%s AND b.target=u.id) OR (b.actor=u.id AND b.target=%s))
            ORDER BY lower(u.first_name),u.id""",
            (g.uid, g.uid, g.uid, g.uid, g.uid, g.uid),
        ).fetchall()
        blocks = conn.execute(
            "SELECT b.target AS actor,u.username FROM blocks b JOIN users u ON u.id=b.target WHERE b.actor=%s",
            (g.uid,),
        ).fetchall()
    likes, sent, connections = [], [], {}
    for relationship in relationships:
        is_sent = relationship.pop("sent")
        if relationship["connected"]:
            connections.setdefault(relationship["actor"], relationship)
        else:
            (sent if is_sent else likes).append(relationship)
    return jsonify(
        visitors=visitors[:50],
        likes=likes,
        sent=sent,
        connections=list(connections.values()),
        blocks=blocks,
        next_before=visitors[49]["id"] if len(visitors) > 50 else None,
    )


@bp.route("/api/v1/me/presence", methods=["POST", "DELETE"])
@auth
def presence():
    tab = text(data().get("tab_id"), "Tab identifier", 100)
    with db() as conn:
        lock_account(conn, g.uid, g.session_token)
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


@bp.get("/api/v1/me/summary")
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


@bp.get("/api/v1/tags")
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


@bp.get("/api/v1/locations")
@auth
def locations():
    if "latitude" in request.args or "longitude" in request.args:
        try:
            latitude = float(request.args["latitude"])
            longitude = float(request.args["longitude"])
            if not (
                math.isfinite(latitude)
                and math.isfinite(longitude)
                and -90 <= latitude <= 90
                and -180 <= longitude <= 180
            ):
                raise ValueError()
        except (KeyError, ValueError):
            fail("Provide valid GPS coordinates", field="city")
        return jsonify(
            locations=search_locations(latitude=latitude, longitude=longitude)
        )
    query = request.args.get("q", "").strip()
    if len(query) > 100 or ";" in query:
        fail(
            "Location search must contain at most 100 characters and no semicolons",
            field="city",
        )
    if len(query) < 3:
        return jsonify(locations=[])
    return jsonify(locations=search_locations(query))
