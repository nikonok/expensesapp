package family

// devices.go — POST /v1/family/devices/{id}/envelope handler.
// See architecture.md §8.2 for the second-device join flow.

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	internaldb "github.com/nikonok/expensesapp/backend/internal/db"
	"github.com/nikonok/expensesapp/backend/internal/db/gen"
	"github.com/nikonok/expensesapp/backend/internal/httpx"
	"github.com/nikonok/expensesapp/backend/internal/live"
)

// envelopeRequest is the JSON body for POST /v1/family/devices/{id}/envelope.
type envelopeRequest struct {
	Envelope string `json:"envelope"` // base64url 80-byte sealed-box
}

// SetHub wires the SSE hub into the family Handler for device.activated notifications.
// Must be called before the server starts serving requests.
func (h *Handler) SetHub(hub *live.Hub) {
	h.hub = hub
}

// PostDeviceEnvelope handles POST /v1/family/devices/{id}/envelope.
//
// The calling user must be an active member of the same family as the target
// device's owner. On success it atomically:
//   - inserts a device_envelopes row for the target device, and
//   - sets devices.status='active' for the target device.
//
// Then it emits a device.activated SSE event to the target device's scope.
func (h *Handler) PostDeviceEnvelope(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 16*1024)

	ctx := r.Context()
	uploaderUserID := httpx.UserID(ctx)
	targetDeviceID := chi.URLParam(r, "id")

	var req envelopeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "invalid JSON body")
		return
	}

	if req.Envelope == "" {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "envelope is required")
		return
	}

	// Decode and validate envelope: must be exactly 80 bytes.
	wrappedKey, err := decodeBase64URL(req.Envelope)
	if err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "envelope is not valid base64url")
		return
	}
	if len(wrappedKey) != 80 {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad-request", "envelope must be exactly 80 bytes")
		return
	}

	q := gen.New(h.db)
	now := nowUTC()
	nowStr := httpx.FormatTime(now)

	// Load the target device.
	targetDevice, err := q.GetDeviceByID(ctx, targetDeviceID)
	if errors.Is(err, sql.ErrNoRows) {
		httpx.WriteError(w, r, http.StatusNotFound, "not-found", "device not found")
		return
	}
	if err != nil {
		slog.WarnContext(ctx, "family.devices: get target device error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	// The target device must be in 'pending' state.
	if targetDevice.Status != "pending" {
		httpx.WriteError(w, r, http.StatusConflict, "device-not-pending", "target device is not in pending state")
		return
	}

	// Verify uploader belongs to the same family as the target device's owner.
	uploaderMember, err := q.GetActiveFamilyMember(ctx, uploaderUserID)
	if errors.Is(err, sql.ErrNoRows) {
		httpx.WriteError(w, r, http.StatusForbidden, "family-required", "uploader has no active family")
		return
	}
	if err != nil {
		slog.WarnContext(ctx, "family.devices: get uploader family error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	targetOwnerMember, err := q.GetActiveFamilyMember(ctx, targetDevice.UserID)
	if errors.Is(err, sql.ErrNoRows) {
		httpx.WriteError(w, r, http.StatusForbidden, "family-required", "target device owner has no active family")
		return
	}
	if err != nil {
		slog.WarnContext(ctx, "family.devices: get target owner family error", "err", err)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	if uploaderMember.FamilyID != targetOwnerMember.FamilyID {
		httpx.WriteError(w, r, http.StatusForbidden, "forbidden", "uploader and target device are not in the same family")
		return
	}

	familyID := uploaderMember.FamilyID

	// Atomically insert device_envelopes + activate the device.
	txErr := internaldb.WithTx(ctx, h.db, func(tx *sql.Tx) error {
		qt := gen.New(tx)

		if err := qt.InsertDeviceEnvelope(ctx, gen.InsertDeviceEnvelopeParams{
			DeviceID:   targetDeviceID,
			FamilyID:   familyID,
			WrappedKey: wrappedKey,
			Version:    0x10,
			CreatedAt:  nowStr,
		}); err != nil {
			return err
		}

		_, err := tx.ExecContext(ctx,
			`UPDATE devices SET status = 'active' WHERE id = ? AND status = 'pending'`,
			targetDeviceID,
		)
		return err
	})
	if txErr != nil {
		slog.WarnContext(ctx, "family.devices: envelope tx error", "err", txErr)
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal", "")
		return
	}

	// Audit log.
	_ = insertAudit(ctx, h.db, uploaderUserID, "", "device.join", "device", targetDeviceID, nowStr)

	// Publish device.activated SSE event to the target device's scope.
	if h.hub != nil {
		type deviceActivatedPayload struct {
			DeviceID string `json:"deviceId"`
			Envelope string `json:"envelope"`
		}
		if data, err := json.Marshal(deviceActivatedPayload{
			DeviceID: targetDeviceID,
			Envelope: req.Envelope,
		}); err == nil {
			h.hub.Publish("device:"+targetDeviceID, live.Event{
				Type: "device.activated",
				Data: data,
			})
		} else {
			slog.WarnContext(ctx, "family.devices: marshal device.activated payload failed", "err", err)
		}
	}

	w.WriteHeader(http.StatusNoContent)
}
