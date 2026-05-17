// Package version exposes build-time version information injected via ldflags.
package version

// Tag and Commit are set at build time via:
//
//	-ldflags "-X 'github.com/nikonok/expensesapp/backend/internal/version.Tag=v0.0.0' -X '....Commit=<sha>'"
var (
	Tag    = "dev"
	Commit = "unknown"
)

// String returns the canonical version string "Tag+Commit".
func String() string {
	return Tag + "+" + Commit
}
