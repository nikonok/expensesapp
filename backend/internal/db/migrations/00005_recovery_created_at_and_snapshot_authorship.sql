-- +goose Up
-- +goose StatementBegin

-- The client binds a createdAt string into the recovery-envelope AAD at
-- family-creation time. The server previously only had families.created_at
-- (server clock), which never matches the client's opaque value, breaking
-- recovery. Store the client-supplied value verbatim (byte-identical) here;
-- fall back to families.created_at when this column is NULL (families
-- created before this migration, or families.init calls that omitted it).
ALTER TABLE families ADD COLUMN recovery_created_at TEXT;

-- Snapshot restore must preserve the added_by_user/edited_by_user that were
-- bound into a record's AAD at snapshot time — rewriting them to the
-- restoring caller makes the (unchanged) ciphertext undecryptable. Capture
-- them on the snapshot entry so restore can reapply the original values.
ALTER TABLE snapshot_entries ADD COLUMN added_by_user TEXT REFERENCES users(id);
ALTER TABLE snapshot_entries ADD COLUMN edited_by_user TEXT REFERENCES users(id);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

ALTER TABLE snapshot_entries DROP COLUMN edited_by_user;
ALTER TABLE snapshot_entries DROP COLUMN added_by_user;
ALTER TABLE families DROP COLUMN recovery_created_at;

-- +goose StatementEnd
