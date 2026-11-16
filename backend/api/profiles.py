from flask import Blueprint
from app import (
    BytesIO,
    SearchFilters,
    age_on,
    auth,
    blocked,
    cmp_to_key,
    connected,
    create_photo,
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

bp = Blueprint("profiles", __name__)


@bp.get("/api/v1/me")
@auth
def me():
    with db() as conn:
        user = conn.execute(
            "SELECT id,email,username,first_name,last_name,birth_date,gender,preferences,bio,city,latitude,longitude,tags,map_visible FROM users WHERE id=%s",
            (g.uid,),
        ).fetchone()
        user["photos"] = conn.execute(
            "SELECT id,is_primary FROM photos WHERE user_id=%s ORDER BY is_primary DESC,id",
            (g.uid,),
        ).fetchall()
    if user["birth_date"]:
        user["birth_date"] = user["birth_date"].isoformat()
    return jsonify(user=user, csrf=g.csrf)


@bp.put("/api/v1/me/profile")
@auth
def edit_profile():
    fields = profile_fields(select_location(data()))
    with db() as conn:
        conn.execute(
            "UPDATE users SET first_name=%s,last_name=%s,birth_date=%s,gender=%s,preferences=%s,bio=%s,city=%s,latitude=%s,longitude=%s,tags=%s,map_visible=COALESCE(%s,map_visible) WHERE id=%s",
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
                    "map_visible",
                )
            )
            + (g.uid,),
        )
    return {"message": "Profile saved"}


@bp.post("/api/v1/me/photos")
@auth
def upload():
    file = request.files.get("photo")
    if not file:
        fail("Select an image", field="photo")
    return create_photo(g.uid, encode_photo(file.stream)), 201


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
            """SELECT u.id,u.first_name,u.birth_date,u.city,u.latitude,u.longitude,
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
                    "UPDATE photos SET is_primary=true WHERE id=(SELECT id FROM photos WHERE user_id=%s ORDER BY id LIMIT 1)",
                    (g.uid,),
                )
        else:
            conn.execute(
                "UPDATE photos SET is_primary=false WHERE user_id=%s", (g.uid,)
            )
            conn.execute("UPDATE photos SET is_primary=true WHERE id=%s", (photo_id,))
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
