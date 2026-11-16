ALTER TABLE users
ADD COLUMN IF NOT EXISTS map_visible boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS discoverable_map_users
ON users (id)
WHERE map_visible;
