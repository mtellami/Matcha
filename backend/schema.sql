-- Current database schema for fresh installations.
CREATE TABLE IF NOT EXISTS users (
  id bigserial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  username text NOT NULL UNIQUE,
  first_name text NOT NULL,
  last_name text NOT NULL,
  password_hash text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  birth_date date,
  gender text,
  preferences text[] NOT NULL DEFAULT ARRAY['man', 'woman'],
  bio text NOT NULL DEFAULT '',
  city text,
  latitude double precision,
  longitude double precision,
  tags text[] NOT NULL DEFAULT '{}',
  last_seen timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  map_visible boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  csrf text NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS tokens (
  token text PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('verify', 'reset', 'email')),
  expires_at timestamptz NOT NULL,
  pending_email text
);

CREATE TABLE IF NOT EXISTS photos (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  filename text NOT NULL UNIQUE,
  is_primary boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS one_primary_photo ON photos (user_id) WHERE is_primary;
CREATE INDEX IF NOT EXISTS photos_user_position ON photos (user_id, position, id);

CREATE TABLE IF NOT EXISTS likes (
  actor bigint REFERENCES users (id),
  target bigint REFERENCES users (id),
  PRIMARY KEY (actor, target), CHECK (actor <> target)
);
CREATE TABLE IF NOT EXISTS blocks (
  actor bigint REFERENCES users (id),
  target bigint REFERENCES users (id),
  PRIMARY KEY (actor, target), CHECK (actor <> target)
);
CREATE TABLE IF NOT EXISTS visits (
  id bigserial PRIMARY KEY,
  actor bigint REFERENCES users (id), target bigint REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS reports (
  id bigserial PRIMARY KEY,
  actor bigint REFERENCES users (id), target bigint REFERENCES users (id),
  reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS messages (
  id bigserial PRIMARY KEY,
  actor bigint REFERENCES users (id), target bigint REFERENCES users (id),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  client_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  is_read boolean NOT NULL DEFAULT false, UNIQUE (actor, client_id)
);
CREATE TABLE IF NOT EXISTS message_attachments (
  id bigserial PRIMARY KEY,
  message_id bigint NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
  filename text NOT NULL UNIQUE,
  display_name text NOT NULL,
  content_type text NOT NULL,
  attachment_kind text NOT NULL CHECK (attachment_kind IN ('photo', 'document', 'voice')),
  size integer NOT NULL CHECK (size > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notifications (
  id bigserial PRIMARY KEY,
  actor bigint REFERENCES users (id), target bigint REFERENCES users (id),
  kind text NOT NULL, is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), delivered boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS muted_notifications (
  actor bigint REFERENCES users (id), target bigint REFERENCES users (id),
  PRIMARY KEY (actor, target)
);
CREATE TABLE IF NOT EXISTS request_limits (
  key text PRIMARY KEY, starts_at timestamptz NOT NULL DEFAULT now(), attempts integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS presence (
  session_token text NOT NULL REFERENCES sessions(token) ON DELETE CASCADE,
  tab_id text NOT NULL, expires_at timestamptz NOT NULL,
  PRIMARY KEY (session_token, tab_id)
);
CREATE TABLE IF NOT EXISTS photo_deletions (
  filename text PRIMARY KEY, ready_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS oauth_identities (
  provider text NOT NULL CHECK (provider IN ('google', 'github')),
  subject text NOT NULL,
  user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (provider, subject)
);
CREATE TABLE IF NOT EXISTS calls (
  id text PRIMARY KEY,
  caller bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  callee bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  media text NOT NULL CHECK (media IN ('audio', 'video')),
  status text NOT NULL CHECK (status IN ('ringing', 'active')),
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  CHECK (caller <> callee)
);
CREATE TABLE IF NOT EXISTS date_events (
  id bigserial PRIMARY KEY,
  creator bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  invitee bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
  location text NOT NULL CHECK (length(location) BETWEEN 1 AND 160),
  details text NOT NULL DEFAULT '' CHECK (length(details) <= 500),
  starts_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(), CHECK (creator <> invitee)
);

CREATE INDEX IF NOT EXISTS notification_target ON notifications (target, id DESC);
CREATE INDEX IF NOT EXISTS notification_delivery ON notifications (id) WHERE NOT delivered;
CREATE INDEX IF NOT EXISTS visits_target ON visits (target, id DESC);
CREATE INDEX IF NOT EXISTS messages_pair ON messages (actor, target, id DESC);
CREATE INDEX IF NOT EXISTS unread_messages ON messages (target, actor, id) WHERE NOT is_read;
CREATE INDEX IF NOT EXISTS user_tags ON users USING gin (tags);
CREATE INDEX IF NOT EXISTS likes_target ON likes (target);
CREATE INDEX IF NOT EXISTS presence_expiry ON presence (expires_at);
CREATE INDEX IF NOT EXISTS oauth_identities_user_id ON oauth_identities (user_id);
CREATE INDEX IF NOT EXISTS discoverable_map_users ON users (id) WHERE map_visible;
CREATE INDEX IF NOT EXISTS calls_participant_expiry ON calls (caller, callee, expires_at);
CREATE INDEX IF NOT EXISTS date_events_pair_time ON date_events (creator, invitee, starts_at DESC);
