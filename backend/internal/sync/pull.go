package sync

import (
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/nikonok/expensesapp/backend/internal/httpx"
)

const (
	defaultPullLimit = 500
	maxPullLimit     = 500
)

// pullRecord is one record in the pull response.
type pullRecord struct {
	RecordID     string            `json:"recordId"`
	RecordType   string            `json:"recordType"`
	Blob         string            `json:"blob"` // base64url
	Version      int64             `json:"version"`
	FamilySeq    int64             `json:"familySeq"`
	UpdatedAtMap map[string]string `json:"updatedAtMap"`
	DeletedAt    string            `json:"deletedAt,omitempty"`
	AddedByUser  string            `json:"addedByUser"`
	EditedByUser string            `json:"editedByUser"`
}

// pullResponse is the JSON body for GET /v1/sync/pull.
type pullResponse struct {
	Records    []pullRecord `json:"records"`
	NextCursor string       `json:"nextCursor"`
	HasMore    bool         `json:"hasMore"`
}

// GetPull handles GET /v1/sync/pull?since=<cursor>&limit=<n>.
func (h *Handler) GetPull(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	familyID := httpx.FamilyID(ctx)

	// Parse since cursor.
	sinceStr := r.URL.Query().Get("since")
	afterSeq, err := DecodeCursor(sinceStr)
	if err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "invalid 'since' cursor")
		return
	}

	// Parse limit.
	limit := int64(defaultPullLimit)
	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		l, err := strconv.ParseInt(limitStr, 10, 64)
		if err != nil || l < 1 {
			httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "'limit' must be a positive integer")
			return
		}
		if l > maxPullLimit {
			httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "'limit' must not exceed 500")
			return
		}
		limit = l
	}

	// Fetch one extra record to detect hasMore without a count query.
	rows, err := h.svc.FetchSince(ctx, familyID, afterSeq, limit+1)
	if err != nil {
		slog.WarnContext(ctx, "sync.pull: fetch error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	hasMore := int64(len(rows)) > limit
	if hasMore {
		rows = rows[:limit]
	}

	out := make([]pullRecord, 0, len(rows))
	var lastSeq int64
	for _, row := range rows {
		updAtMap, err := unmarshalStringMap(row.UpdatedAtMap)
		if err != nil {
			updAtMap = map[string]string{}
		}
		blobB64 := base64.RawURLEncoding.EncodeToString(row.Ciphertext)
		pr := pullRecord{
			RecordID:     row.RecordID,
			RecordType:   row.RecordType,
			Blob:         blobB64,
			Version:      row.Version,
			FamilySeq:    row.FamilySeq,
			UpdatedAtMap: updAtMap,
			AddedByUser:  row.AddedByUser,
			EditedByUser: row.EditedByUser,
		}
		if row.DeletedAt.Valid {
			pr.DeletedAt = row.DeletedAt.String
		}
		out = append(out, pr)
		lastSeq = row.FamilySeq
	}

	// The next cursor is the last family_seq returned.
	// If no rows, echo the incoming cursor so clients can resume unchanged.
	nextSeq := afterSeq
	if lastSeq > 0 {
		nextSeq = lastSeq
	}

	httpx.WriteJSON(w, http.StatusOK, pullResponse{
		Records:    out,
		NextCursor: EncodeCursor(nextSeq),
		HasMore:    hasMore,
	})
}

// unmarshalStringMap parses a JSON object string into map[string]string.
func unmarshalStringMap(s string) (map[string]string, error) {
	var m map[string]string
	if err := json.Unmarshal([]byte(s), &m); err != nil {
		return nil, err
	}
	return m, nil
}
