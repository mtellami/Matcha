ALTER TABLE messages ADD COLUMN is_read boolean NOT NULL DEFAULT false;
CREATE INDEX unread_messages ON messages(target,actor,id) WHERE NOT is_read;
CREATE TABLE presence (
    session_token text NOT NULL REFERENCES sessions(token) ON DELETE CASCADE,
    tab_id text NOT NULL,
    expires_at timestamptz NOT NULL,
    PRIMARY KEY(session_token,tab_id)
);
CREATE INDEX presence_expiry ON presence(expires_at);
