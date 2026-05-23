package live

// Heartbeat is implemented as a per-subscriber time.Ticker inside the SSE
// handler goroutine (see sse.go). Each connection manages its own ticker,
// writing an SSE comment every heartbeatInterval (25 s). This avoids a
// global ticker goroutine and keeps the package goroutine-free at package
// initialization time.
//
// HeartbeatInterval is exported so tests can verify the constant.
const HeartbeatInterval = heartbeatInterval
