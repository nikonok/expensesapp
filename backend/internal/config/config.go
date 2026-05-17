// Package config loads service configuration from environment variables.
package config

import "github.com/caarlos0/env/v11"

// Config holds all runtime configuration for the API server.
type Config struct {
	BindAddr string `env:"BIND_ADDR" envDefault:":8080"`
	LogLevel string `env:"LOG_LEVEL" envDefault:"info"`
	DBPath   string `env:"DB_PATH"   envDefault:"./data.db"`
}

// Load parses Config from environment variables, returning an error if any
// required variable is missing or cannot be parsed.
func Load() (Config, error) {
	return env.ParseAs[Config]()
}
