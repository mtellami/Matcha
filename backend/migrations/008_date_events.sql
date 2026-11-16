CREATE TABLE IF NOT EXISTS date_events (
  id bigserial PRIMARY KEY,
  creator bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  invitee bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
  location text NOT NULL CHECK (length(location) BETWEEN 1 AND 160),
  details text NOT NULL DEFAULT '' CHECK (length(details) <= 500),
  starts_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (creator <> invitee)
);

CREATE INDEX IF NOT EXISTS date_events_pair_time
ON date_events (creator, invitee, starts_at DESC);
