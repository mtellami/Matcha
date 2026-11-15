ALTER TABLE notifications
ADD COLUMN delivered boolean NOT NULL DEFAULT false;

CREATE TABLE muted_notifications (
  actor bigint REFERENCES users (id),
  target bigint REFERENCES users (id),
  PRIMARY KEY (actor, target)
);

CREATE TABLE request_limits (
  key text PRIMARY KEY,
  starts_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0
);

CREATE INDEX notification_delivery ON notifications (id)
WHERE
  NOT delivered;

ALTER TABLE tokens
DROP CONSTRAINT tokens_kind_check;

ALTER TABLE tokens
ADD CONSTRAINT tokens_kind_check CHECK (kind IN ('verify', 'reset', 'email'));

ALTER TABLE tokens
ADD COLUMN pending_email text;
