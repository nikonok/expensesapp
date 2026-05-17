package httpx

import (
	"log/slog"
	"net/http"
	"time"

	chimiddleware "github.com/go-chi/chi/v5/middleware"
)

// LoggerMiddleware returns a chi-compatible middleware that logs one structured
// line per request. It never logs request bodies, response bodies, or headers.
func LoggerMiddleware(base *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()

			// Capture status + bytes written.
			ww := chimiddleware.NewWrapResponseWriter(w, r.ProtoMajor)

			// Propagate chi's request ID into our context key.
			reqID := chimiddleware.GetReqID(r.Context())
			ctx := WithRequestID(r.Context(), reqID)
			r = r.WithContext(ctx)

			next.ServeHTTP(ww, r)

			elapsed := time.Since(start)
			uid := UserID(r.Context())
			did := DeviceID(r.Context())

			base.Info("request",
				"request_id", reqID,
				"user_id", uid,
				"device_id", did,
				"method", r.Method,
				"path", r.URL.Path,
				"status", ww.Status(),
				"duration_ms", elapsed.Milliseconds(),
				"bytes_out", ww.BytesWritten(),
			)
		})
	}
}
