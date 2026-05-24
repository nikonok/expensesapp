-- +goose Up
CREATE TABLE support_logs (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    payload    BLOB NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX idx_support_logs_user ON support_logs(user_id);

-- +goose Down
DROP INDEX IF EXISTS idx_support_logs_user;
DROP TABLE IF EXISTS support_logs;
