/* Run only against a migrated disposable database. All fixture data rolls back. */
BEGIN;
SET LOCAL plpgsql.check_asserts=on;
INSERT INTO users(email,username,first_name,last_name,password_hash,verified,birth_date,gender,preferences,bio,city,latitude,longitude,tags)
SELECT 'sql-smoke-'||n||'@example.test','sql_smoke_'||n,'SQL '||n,'Fixture','not-a-login-hash',true,
       DATE '1980-01-01'+((n%30)*INTERVAL '1 year'),
       CASE WHEN n%2=0 THEN 'woman' ELSE 'man' END,
       ARRAY['man','woman'],'A synthetic database validation profile.',
       CASE WHEN n%5=0 THEN 'Rabat' ELSE 'Casablanca' END,
       CASE WHEN n%5=0 THEN 34.02 ELSE 33.59 END,
       CASE WHEN n%5=0 THEN -6.84 ELSE -7.62 END,ARRAY['coffee','music']
FROM generate_series(1,500) AS n;

DO $$
DECLARE a bigint; b bigint; cutoff bigint; first_page bigint[]; second_page bigint[];
BEGIN
    SELECT id INTO a FROM users WHERE username='sql_smoke_1';
    SELECT id INTO b FROM users WHERE username='sql_smoke_2';
    ASSERT (SELECT count(*) FROM users WHERE starts_with(username,'sql_smoke_'))=500,'Expected 500 profiles';
    INSERT INTO likes VALUES(a,b),(b,a);
    ASSERT (SELECT count(*) FROM likes WHERE (actor=a AND target=b) OR (actor=b AND target=a))=2,'Mutual likes missing';
    INSERT INTO messages(actor,target,body,client_id)
    SELECT b,a,'message '||n,'sql-smoke-'||n FROM generate_series(1,120) AS n;
    INSERT INTO messages(actor,target,body,client_id) VALUES(b,a,'duplicate','sql-smoke-1') ON CONFLICT DO NOTHING;
    ASSERT (SELECT count(*) FROM messages WHERE actor=b AND target=a)=120,'Duplicate message inserted';
    SELECT array_agg(id ORDER BY id) INTO first_page FROM
        (SELECT id FROM messages WHERE ((actor=a AND target=b) OR (actor=b AND target=a)) AND id>0 ORDER BY id ASC LIMIT 50) AS batch;
    cutoff=first_page[50];
    SELECT array_agg(id ORDER BY id) INTO second_page FROM
        (SELECT id FROM messages WHERE ((actor=a AND target=b) OR (actor=b AND target=a)) AND id>cutoff ORDER BY id ASC LIMIT 50) AS batch;
    ASSERT cardinality(first_page)=50 AND cardinality(second_page)=50,'Incremental pages are incomplete';
    ASSERT NOT(first_page && second_page),'Incremental pages overlap';
    ASSERT (SELECT count(*) FROM messages WHERE actor=b AND target=a AND id>second_page[50])=20,'Recovery lost the final batch';
    UPDATE messages SET is_read=true WHERE actor=b AND target=a AND id<=cutoff;
    ASSERT (SELECT count(*) FROM messages WHERE actor=b AND target=a AND NOT is_read)=70,'Read acknowledgement consumed newer messages';
    INSERT INTO sessions VALUES('sql-smoke-session',a,'sql-smoke-csrf',now()+interval '1 hour');
    INSERT INTO presence VALUES('sql-smoke-session','tab-one',now()+interval '20 seconds'),('sql-smoke-session','tab-two',now()+interval '20 seconds');
    DELETE FROM presence WHERE session_token='sql-smoke-session' AND tab_id='tab-one';
    ASSERT EXISTS(SELECT 1 FROM presence p JOIN sessions s ON s.token=p.session_token WHERE s.user_id=a AND s.expires_at>now() AND p.expires_at>now()),'Closing one tab incorrectly cleared presence';
    UPDATE sessions SET expires_at=now()-interval '1 second' WHERE token='sql-smoke-session';
    ASSERT NOT EXISTS(SELECT 1 FROM presence p JOIN sessions s ON s.token=p.session_token WHERE s.user_id=a AND s.expires_at>now() AND p.expires_at>now()),'Expired session still appears online';
    DELETE FROM sessions WHERE token='sql-smoke-session';
    ASSERT NOT EXISTS(SELECT 1 FROM presence WHERE session_token='sql-smoke-session'),'Revoked session retained presence';
    INSERT INTO notifications(actor,target,kind) VALUES(b,a,'message');
    INSERT INTO muted_notifications VALUES(b,a);
    ASSERT NOT EXISTS(SELECT 1 FROM notifications n WHERE n.target=a AND NOT EXISTS(SELECT 1 FROM muted_notifications m WHERE m.actor=n.actor AND m.target=n.target)),'Muted event remains visible';
    DELETE FROM muted_notifications WHERE actor=b AND target=a;
    INSERT INTO blocks VALUES(a,b);
    DELETE FROM likes WHERE (actor=a AND target=b) OR (actor=b AND target=a);
    ASSERT NOT EXISTS(SELECT 1 FROM likes WHERE (actor=a AND target=b) OR (actor=b AND target=a)),'Blocking did not disconnect';
    ASSERT NOT EXISTS(SELECT 1 FROM notifications n WHERE n.target=a AND NOT EXISTS(SELECT 1 FROM blocks x WHERE (x.actor=n.actor AND x.target=n.target) OR (x.actor=n.target AND x.target=n.actor))),'Blocked event remains visible';
END
$$;

EXPLAIN (ANALYZE,BUFFERS,TIMING OFF)
SELECT u.id,u.username,u.first_name,u.last_name,u.birth_date,u.gender,u.bio,u.city,u.tags,u.latitude,u.longitude,
       (SELECT count(*) FROM likes WHERE target=u.id) AS likes,
       (SELECT id FROM photos WHERE user_id=u.id AND is_primary) AS photo_id
FROM users u
WHERE u.id<>(SELECT id FROM users WHERE username='sql_smoke_1') AND u.verified
  AND u.gender=ANY(ARRAY['man','woman']) AND 'man'=ANY(u.preferences)
  AND u.birth_date IS NOT NULL AND u.latitude IS NOT NULL AND u.bio<>'' AND cardinality(u.tags)>0
  AND NOT EXISTS(SELECT 1 FROM blocks WHERE
     (actor=(SELECT id FROM users WHERE username='sql_smoke_1') AND target=u.id)
     OR (actor=u.id AND target=(SELECT id FROM users WHERE username='sql_smoke_1')));
ROLLBACK;
