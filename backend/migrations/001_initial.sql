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
  created_at timestamptz NOT NULL DEFAULT now()
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
  kind text NOT NULL CHECK (kind IN ('verify', 'reset')),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS photos (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  filename text NOT NULL UNIQUE,
  is_primary boolean NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS one_primary_photo ON photos (user_id)
WHERE
  is_primary;

CREATE TABLE IF NOT EXISTS likes (
  actor bigint REFERENCES users (id),
  target bigint REFERENCES users (id),
  PRIMARY KEY (actor, target),
  CHECK (actor <> target)
);

CREATE TABLE IF NOT EXISTS blocks (
  actor bigint REFERENCES users (id),
  target bigint REFERENCES users (id),
  PRIMARY KEY (actor, target),
  CHECK (actor <> target)
);

CREATE TABLE IF NOT EXISTS visits (
  id bigserial PRIMARY KEY,
  actor bigint REFERENCES users (id),
  target bigint REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reports (
  id bigserial PRIMARY KEY,
  actor bigint REFERENCES users (id),
  target bigint REFERENCES users (id),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id bigserial PRIMARY KEY,
  actor bigint REFERENCES users (id),
  target bigint REFERENCES users (id),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  client_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor, client_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id bigserial PRIMARY KEY,
  actor bigint REFERENCES users (id),
  target bigint REFERENCES users (id),
  kind text NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_target ON notifications (target, id DESC);

CREATE INDEX IF NOT EXISTS visits_target ON visits (target, id DESC);

CREATE INDEX IF NOT EXISTS messages_pair ON messages (actor, target, id DESC);

CREATE INDEX IF NOT EXISTS user_tags ON users USING gin (tags);

CREATE INDEX IF NOT EXISTS likes_target ON likes (target);
