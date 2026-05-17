package db

import (
	"context"
	"database/sql"
	"fmt"
)

// WithTx runs fn inside a single SQLite write transaction and commits on success,
// rolling back on error or panic. The DSN opened via Open already sets
// _txlock=immediate so every non-read-only BeginTx issues "BEGIN IMMEDIATE",
// preventing writer starvation under WAL without extra wrapping here.
func WithTx(ctx context.Context, db *sql.DB, fn func(*sql.Tx) error) (retErr error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback()
			panic(p)
		}
		if retErr != nil {
			_ = tx.Rollback()
			return
		}
		if err := tx.Commit(); err != nil {
			retErr = fmt.Errorf("commit: %w", err)
		}
	}()
	return fn(tx)
}
