//go:build integration

package auth

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCache_HitOnSecondValidate(t *testing.T) {
	clearCache()
	ctx := context.Background()
	db := newTestDB(t)
	_, deviceID := seedUserAndDevice(t, ctx, db)

	now := time.Now().UTC()
	cookie, _, err := Mint(ctx, db, deviceID, now)
	require.NoError(t, err)

	// First Validate — cache miss, populates cache.
	info1, err := Validate(ctx, db, cookie, now)
	require.NoError(t, err)
	require.NotNil(t, info1)

	size := CacheSize()
	t.Logf("cache size after first Validate: %d", size)
	assert.Greater(t, size, 0, "cache should have at least one entry after first Validate")

	// Second Validate — should hit cache.
	info2, err := Validate(ctx, db, cookie, now)
	require.NoError(t, err)
	require.NotNil(t, info2)
	assert.Equal(t, info1.SessionID, info2.SessionID)
}
