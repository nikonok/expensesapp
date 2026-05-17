// Package log constructs a structured slog.Logger for the API server.
package log

import (
	"log/slog"
	"os"
)

// New returns a JSON-handler slog.Logger writing to stdout at the given level.
// Accepted levels: "debug", "info", "warn", "error". Unknown values default to info.
func New(level string) *slog.Logger {
	var l slog.Level
	switch level {
	case "debug":
		l = slog.LevelDebug
	case "warn":
		l = slog.LevelWarn
	case "error":
		l = slog.LevelError
	default:
		l = slog.LevelInfo
	}
	h := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: l})
	return slog.New(h)
}

// SetDefault installs l as the default slog logger.
func SetDefault(l *slog.Logger) {
	slog.SetDefault(l)
}
