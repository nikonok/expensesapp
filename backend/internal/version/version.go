// Package version exposes build-time version information injected via ldflags.
package version

// Tag, Commit, and BuildTime are set at build time via:
//
//	-ldflags "-X 'github.com/nikonok/expensesapp/backend/internal/version.Tag=v1.0.0' \
//	          -X '....Commit=<sha>' \
//	          -X '....BuildTime=<rfc3339>'"
var (
	Tag       = "dev"
	Commit    = "unknown"
	BuildTime = ""
)

// String returns the canonical version string "Tag+Commit".
func String() string {
	return Tag + "+" + Commit
}
