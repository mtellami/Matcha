from app import (
    BytesIO,
    SearchFilters,
    age_on,
    auth,
    blocked,
    cmp_to_key,
    connected,
    create_photo,
    current_session,
    data,
    date,
    db,
    distance_km,
    encode_photo,
    fail,
    fame_rating,
    g,
    is_online,
    jsonify,
    notify,
    pair_lock,
    profile_fields,
    request,
    select_location,
    send_file,
    storage,
    text,
)
from flask import Blueprint

bp = Blueprint("profiles", __name__)


def _current_user():
    with db() as conn:
        user = conn.execute(
            "SELECT id,email,username,first_name,last_name,birth_date,gender,preferences,bio,city,latitude,longitude,tags,map_visible FROM users WHERE id=%s",
            (g.uid,),
        ).fetchone()
        user["photos"] = conn.execute(
            "SELECT id,is_primary FROM photos WHERE user_id=%s ORDER BY position,id",
            (g.uid,),
        ).fetchall()
    if user["birth_date"]:
        user["birth_date"] = user["birth_date"].isoformat()
    return user


@bp.get("/api/v1/me/session")
def me_session():
    session = current_session()
    if not session:
        return jsonify(user=None, csrf="")
    g.uid = session["user_id"]
    g.csrf = session["csrf"]
    return jsonify(user=_current_user(), csrf=g.csrf)


@bp.get("/api/v1/me")
@auth
def me():
    return jsonify(user=_current_user(), csrf=g.csrf)


@bp.put("/api/v1/me/profile")
@bp.patch("/api/v1/me/profile")
@auth
def edit_profile():
    submitted = data()
    location_keys = {"city", "latitude", "longitude", "location_id", "location_source"}
    submitted = (
        select_location(submitted)
        if location_keys.intersection(submitted)
        else submitted
    )
    fields = profile_fields(submitted, partial=True)
    columns = {
        "first_name": "first_name",
        "last_name": "last_name",
        "birth_date": "birth_date",
        "gender": "gender",
        "preferences": "preferences",
        "bio": "bio",
        "city": "city",
        "latitude": "latitude",
        "longitude": "longitude",
        "tags": "tags",
        "map_visible": "map_visible",
    }
    updates = [
        (column, fields[key]) for key, column in columns.items() if key in fields
    ]
    if not updates:
        return {"message": "No profile changes to save"}
    with db() as conn:
        assignments = ",".join(f"{column}=%s" for column, _ in updates)
        conn.execute(
            f"UPDATE users SET {assignments} WHERE id=%s",
            tuple(value for _, value in updates) + (g.uid,),
        )
    return {"message": "Profile saved"}


@bp.post("/api/v1/me/photos")
@auth
def upload():
    file = request.files.get("photo")
    if not file:
        fail("Select an image", field="photo")
    return create_photo(g.uid, encode_photo(file.stream)), 201


@bp.patch("/api/v1/me/photos/order")
@auth
def reorder_photos():
    submitted = data().get("photo_ids")
    if (
        not isinstance(submitted, list)
        or not 1 <= len(submitted) <= 5
        or any(type(photo_id) is not int for photo_id in submitted)
        or len(set(submitted)) != len(submitted)
    ):
        fail("Photo order is invalid")
    with db() as conn:
        conn.execute("SELECT id FROM users WHERE id=%s FOR UPDATE", (g.uid,))
        existing = conn.execute(
            "SELECT id FROM photos WHERE user_id=%s ORDER BY position,id FOR UPDATE",
            (g.uid,),
        ).fetchall()
        if {photo["id"] for photo in existing} != set(submitted):
            fail("Photo order is invalid")
        conn.execute("UPDATE photos SET is_primary=false WHERE user_id=%s", (g.uid,))
        for position, photo_id in enumerate(submitted):
            conn.execute(
                "UPDATE photos SET position=%s,is_primary=%s WHERE id=%s AND user_id=%s",
                (position, position == 0, photo_id, g.uid),
            )
    return {"message": "Photo order saved"}


@bp.get("/api/v1/photos/<int:photo_id>")
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


@bp.get("/api/v1/profiles")
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
        EXISTS(SELECT 1 FROM likes WHERE actor=%s AND target=u.id) AS liked,
        (SELECT id FROM photos WHERE user_id=u.id AND is_primary) AS photo_id
        FROM users u WHERE u.id<>%s AND u.verified AND u.gender=ANY(%s)
        AND %s=ANY(u.preferences) AND u.birth_date IS NOT NULL AND u.latitude IS NOT NULL AND u.bio<>''
        AND cardinality(u.tags)>0 AND NOT EXISTS(SELECT 1 FROM blocks WHERE
          (actor=%s AND target=u.id) OR (actor=u.id AND target=%s))""",
            (g.uid, g.uid, own["preferences"], own["gender"], g.uid, g.uid),
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
    if key == "suggested":
        descending = filters.direction == "desc"

        def compare_suggestions(a, b):
            a_local = a["city"].casefold() == own["city"].casefold()
            b_local = b["city"].casefold() == own["city"].casefold()
            if a_local != b_local:
                return -1 if a_local else 1
            a_rank = (a["distance"], -a["common_tags"], -a["fame"], a["id"])
            b_rank = (b["distance"], -b["common_tags"], -b["fame"], b["id"])
            comparison = (a_rank > b_rank) - (a_rank < b_rank)
            return -comparison if descending else comparison

        result.sort(key=cmp_to_key(compare_suggestions))
    else:
        result.sort(
            key=lambda u: (u[key], u["id"]),
            reverse=filters.direction == "desc",
        )
    return jsonify(
        profiles=result[(filters.page - 1) * 24 : filters.page * 24],
        total=len(result),
        page=filters.page,
        page_size=24,
    )


@bp.get("/api/v1/map/users")
@auth
def map_users():
    with db() as conn:
        own = conn.execute(
            "SELECT id,gender,preferences FROM users WHERE id=%s", (g.uid,)
        ).fetchone()
        rows = conn.execute(
            """SELECT u.id,u.first_name,u.last_name,u.gender,u.birth_date,u.city,u.latitude,u.longitude,
               (SELECT id FROM photos WHERE user_id=u.id AND is_primary) AS photo_id
               FROM users u
               WHERE u.id<>%s AND u.verified AND u.map_visible
               AND u.gender=ANY(%s) AND %s=ANY(u.preferences)
               AND u.birth_date IS NOT NULL AND u.latitude IS NOT NULL
               AND u.longitude IS NOT NULL AND u.bio<>'' AND cardinality(u.tags)>0
               AND NOT EXISTS (SELECT 1 FROM blocks WHERE
                 (actor=%s AND target=u.id) OR (actor=u.id AND target=%s))
               ORDER BY u.id LIMIT 500""",
            (g.uid, own["preferences"], own["gender"], g.uid, g.uid),
        ).fetchall()
    today = date.today()
    for user in rows:
        user["age"] = age_on(user.pop("birth_date"), today)
    return jsonify(users=rows)


@bp.get("/api/v1/profiles/<int:uid>")
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
            "SELECT id,is_primary FROM photos WHERE user_id=%s ORDER BY position,id",
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


@bp.route("/api/v1/profiles/<int:uid>/like", methods=["POST", "DELETE"])
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


@bp.route("/api/v1/profiles/<int:uid>/block", methods=["POST", "DELETE"])
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


@bp.post("/api/v1/profiles/<int:uid>/reports")
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


@bp.route("/api/v1/me/photos/<int:photo_id>", methods=["PUT", "DELETE"])
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
            conn.execute(
                "INSERT INTO photo_deletions(filename) VALUES(%s) ON CONFLICT DO NOTHING",
                (photo["filename"],),
            )
            conn.execute("DELETE FROM photos WHERE id=%s", (photo_id,))
            if photo["is_primary"]:
                conn.execute(
                    """
                    UPDATE photos SET is_primary=true
                    WHERE id=(SELECT id FROM photos WHERE user_id=%s ORDER BY position,id LIMIT 1)
                """,
                    (g.uid,),
                )
        else:
            conn.execute(
                "UPDATE photos SET is_primary=false,position=position+1 WHERE user_id=%s AND id<>%s",
                (g.uid, photo_id),
            )
            conn.execute(
                "UPDATE photos SET is_primary=true,position=0 WHERE id=%s", (photo_id,)
            )
    return {"message": "Photos updated"}


@bp.get("/api/v1/profiles/<int:uid>/status")
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
