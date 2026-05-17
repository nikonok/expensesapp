package httpx

import (
	"encoding/json"
	"net/http"
)

// WriteJSON serialises v as JSON and writes it with the given status code.
// Sets Content-Type: application/json and Cache-Control: no-store.
// On marshal failure it falls back to a static 500 problem+json body.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	b, err := json.Marshal(v)
	if err != nil {
		w.Header().Set("Content-Type", "application/problem+json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"type":"about:blank","title":"internal","status":500}`))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = w.Write(b)
}

// SetCacheNoStore sets headers that instruct clients and proxies not to cache
// the response. Use on auth-touched endpoints.
func SetCacheNoStore(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
	w.Header().Set("Pragma", "no-cache")
}
