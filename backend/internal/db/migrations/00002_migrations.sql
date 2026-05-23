-- +goose Up
CREATE TABLE migrations (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id),
    source_family_id TEXT,
    target_family_id TEXT NOT NULL,
    record_count    INTEGER NOT NULL,
    committed_at    TEXT NOT NULL
);
CREATE INDEX idx_migrations_user ON migrations(user_id);

-- +goose Down
DROP INDEX IF EXISTS idx_migrations_user;
DROP TABLE IF EXISTS migrations;
