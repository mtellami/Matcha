CREATE TABLE IF NOT EXISTS calls (
  id text PRIMARY KEY,
  caller bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  callee bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  media text NOT NULL CHECK (media IN ('audio', 'video')),
  status text NOT NULL CHECK (status IN ('ringing', 'active')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (caller <> callee)
);

CREATE INDEX IF NOT EXISTS calls_participant_expiry ON calls (caller, callee, expires_at);
