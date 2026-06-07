-- +goose Up
-- +goose StatementBegin

-- B4d: Tolerate the old session token for one additional request after rotation
-- by tracking the previous token hash. SessionMiddleware validates against
-- token_hash OR previous_token_hash; on the next successful rotation
-- previous_token_hash is bumped forward and the old token becomes invalid.
ALTER TABLE sessions ADD COLUMN previous_token_hash BLOB;
CREATE INDEX idx_sessions_previous_token_hash
    ON sessions(previous_token_hash) WHERE previous_token_hash IS NOT NULL AND revoked_at IS NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS idx_sessions_previous_token_hash;
ALTER TABLE sessions DROP COLUMN previous_token_hash;

-- +goose StatementEnd
