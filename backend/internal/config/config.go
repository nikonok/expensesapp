// Package config loads service configuration from environment variables.
package config

import (
	"fmt"

	"github.com/caarlos0/env/v11"
)

// Config holds all runtime configuration for the API server.
type Config struct {
	BindAddr            string `env:"BIND_ADDR"              envDefault:":8080"`
	LogLevel            string `env:"LOG_LEVEL"              envDefault:"info"`
	DBPath              string `env:"DB_PATH"                envDefault:"./data.db"`
	BootstrapAdminEmail string `env:"BOOTSTRAP_ADMIN_EMAIL"  envDefault:""`
	GoogleOAuthClientID string `env:"GOOGLE_OAUTH_CLIENT_ID" envDefault:""`
}

// Load parses Config from environment variables, returning an error if any
// required variable is missing or cannot be parsed.
func Load() (Config, error) {
	cfg, err := env.ParseAs[Config]()
	if err != nil {
		return Config{}, err
	}
	if cfg.BootstrapAdminEmail == "" {
		return Config{}, fmt.Errorf("BOOTSTRAP_ADMIN_EMAIL is required")
	}
	if cfg.GoogleOAuthClientID == "" {
		return Config{}, fmt.Errorf("GOOGLE_OAUTH_CLIENT_ID is required")
	}
	return cfg, nil
}
