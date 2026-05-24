// Package db opens the SQLite database and exposes helpers.
package db

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"

	"github.com/pressly/goose/v3"
	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// Open opens (or creates) the SQLite file at path and applies any pending migrations.
// The returned *sql.DB has WAL + busy_timeout + foreign_keys + temp_store + mmap_size
// + cache_size already applied via the connection string.
func Open(ctx context.Context, path string) (*sql.DB, error) {
	// _txlock=immediate: every db.BeginTx call for non-read-only transactions
	// issues "BEGIN IMMEDIATE", preventing writer starvation under WAL.
	dsn := "file:" + path + "?_pragma=journal_mode(wal)&_pragma=synchronous(normal)" +
		"&_pragma=busy_timeout(5000)&_pragma=foreign_keys(on)" +
		"&_pragma=temp_store(memory)&_pragma=mmap_size(268435456)&_pragma=cache_size(-20000)" +
		"&_txlock=immediate"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("sql.Open: %w", err)
	}
	// One writer connection: serialize writes under SQLite's single-writer model;
	// readers go through the same connection but WAL still allows snapshot reads.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxIdleTime(0)

	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping: %w", err)
	}

	// Use sub-FS so provider receives "*.sql" at the root rather than "migrations/*.sql".
	migFS, err := fs.Sub(migrationsFS, "migrations")
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("migrations sub-fs: %w", err)
	}

	provider, err := goose.NewProvider(goose.DialectSQLite3, db, migFS)
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("goose.NewProvider: %w", err)
	}
	if _, err := provider.Up(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("goose up: %w", err)
	}
	return db, nil
}
