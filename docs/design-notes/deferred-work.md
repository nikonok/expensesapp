# Deferred work

Consciously deferred items from the 2026-07 refinement. Not bugs; revisit when prioritized.

- True per-field sync merge is deferred (currently whole-record LWW via `_all`).
- The 60s backend session-cache revocation window is a documented tradeoff.
- No per-record push count cap exists on the backend (only an 8MiB size cap exists).
- Hooks test coverage is broader than today's tests; expand it.
- `Transaction.isTrashed` is a half-dead field (transactions are hard-deleted; the field remains in the model).
- Family key rotation on member removal is deferred (see [key-rotation.md](key-rotation.md)).
- On joining a new family, a user's other already-active devices stay active without the new family's envelope (needs a product decision).
