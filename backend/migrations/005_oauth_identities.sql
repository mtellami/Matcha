CREATE TABLE IF NOT EXISTS oauth_identities (
  provider text NOT NULL CHECK (provider IN ('google', 'github')),
  subject text NOT NULL,
  user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject)
);

CREATE INDEX IF NOT EXISTS oauth_identities_user_id ON oauth_identities (user_id);
