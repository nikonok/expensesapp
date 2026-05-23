package records

// QuotaMaxBytes is the hard cap per family (200 MiB).
const QuotaMaxBytes = 200 * 1024 * 1024

// ErrQuotaExceeded is returned when a push would exceed the quota.
type ErrQuotaExceeded struct{}

func (ErrQuotaExceeded) Error() string { return "quota exceeded" }

// CheckQuota returns ErrQuotaExceeded if currentBytes + incomingBytes > QuotaMaxBytes.
func CheckQuota(currentBytes, incomingBytes int64) error {
	if currentBytes+incomingBytes > QuotaMaxBytes {
		return ErrQuotaExceeded{}
	}
	return nil
}

// TODO: Phase 13 — nightly reconcile job to recount families.usage_bytes from
// the sum of blobs.byte_count for the family, correcting any incremental drift.
