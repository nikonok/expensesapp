//go:build integration

package auth

// CacheSize returns the current number of cached session entries. Test-only.
func CacheSize() int {
	count := 0
	sessionCache.Range(func(_, _ any) bool {
		count++
		return true
	})
	return count
}

// ClearSessionCache flushes the in-process session cache. Test-only.
func ClearSessionCache() {
	sessionCache.Range(func(k, _ any) bool {
		sessionCache.Delete(k)
		return true
	})
}
