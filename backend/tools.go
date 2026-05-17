//go:build tools

// Package tools pins indirect dependencies required by future workers.
package tools

import (
	_ "github.com/SherClockHolmes/webpush-go"
	_ "github.com/caarlos0/env/v11"
	_ "github.com/go-playground/validator/v10"
	_ "github.com/pressly/goose/v3"
	_ "github.com/stretchr/testify/assert"
	_ "golang.org/x/crypto/bcrypt"
	_ "golang.org/x/time/rate"
	_ "google.golang.org/api/idtoken"
	_ "modernc.org/sqlite"
)
