// Package httpx provides shared HTTP helpers: error envelopes, JSON rendering, and context keys.
package httpx

import (
	"encoding/json"
	"net/http"
)

// Problem is an RFC 9457 Problem Details object.
type Problem struct {
	Type     string `json:"type"`
	Title    string `json:"title"`
	Status   int    `json:"status"`
	Detail   string `json:"detail,omitempty"`
	Instance string `json:"instance,omitempty"`
}

// WriteError writes an RFC 9457 problem+json response.
func WriteError(w http.ResponseWriter, r *http.Request, status int, title, detail string) {
	p := Problem{
		Type:     "about:blank",
		Title:    title,
		Status:   status,
		Detail:   detail,
		Instance: r.URL.Path,
	}
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(p)
}
