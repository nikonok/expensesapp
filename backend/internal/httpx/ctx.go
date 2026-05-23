package httpx

import "context"

type contextKey int

const (
	keyRequestID contextKey = iota + 1
	keyUserID
	keyDeviceID
	keySessionID
	keyFamilyID
)

// WithRequestID returns a child context carrying the given request ID.
func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, keyRequestID, id)
}

// RequestID retrieves the request ID from ctx, or "" if not present.
func RequestID(ctx context.Context) string {
	v, _ := ctx.Value(keyRequestID).(string)
	return v
}

// WithUserID returns a child context carrying the given user ID.
func WithUserID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, keyUserID, id)
}

// UserID retrieves the user ID from ctx, or "" if not present.
func UserID(ctx context.Context) string {
	v, _ := ctx.Value(keyUserID).(string)
	return v
}

// WithDeviceID returns a child context carrying the given device ID.
func WithDeviceID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, keyDeviceID, id)
}

// DeviceID retrieves the device ID from ctx, or "" if not present.
func DeviceID(ctx context.Context) string {
	v, _ := ctx.Value(keyDeviceID).(string)
	return v
}

// WithSessionID returns a child context carrying the given session ID.
func WithSessionID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, keySessionID, id)
}

// SessionID retrieves the session ID from ctx, or "" if not present.
func SessionID(ctx context.Context) string {
	v, _ := ctx.Value(keySessionID).(string)
	return v
}

// WithFamilyID returns a child context carrying the given family ID.
func WithFamilyID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, keyFamilyID, id)
}

// FamilyID retrieves the family ID from ctx, or "" if not present.
func FamilyID(ctx context.Context) string {
	v, _ := ctx.Value(keyFamilyID).(string)
	return v
}
