CREATE TABLE photo_deletions (
    filename text PRIMARY KEY,
    ready_at timestamptz NOT NULL DEFAULT now()
);
