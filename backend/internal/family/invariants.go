package family

// invariants.go — helper checks for family business rules.
// Most of these are Phase 7 stubs; only the constants are defined now so the
// service can reference them without a build-time gap.

// maxFamilyMembers is the hard cap on active members per family (Phase 7).
const maxFamilyMembers = 6

// inviteCoolDownHours is the re-kick cool-down (Phase 7).
const inviteCoolDownHours = 24

// Phase 7 stubs — none of the functions below are called yet; they are
// placeholders to make the architectural contracts visible.

// checkMemberCap would verify that the family has fewer than maxFamilyMembers
// active members before accepting an invite. Implemented in Phase 7.
// func checkMemberCap(ctx context.Context, qt *gen.Queries, familyID string) error

// checkAllowlistGate would verify that the invitee email is on the server
// allowlist. Implemented in Phase 7.
// func checkAllowlistGate(ctx context.Context, qt *gen.Queries, email string) error

// checkCoolDown would verify that a removed member hasn't been removed again
// within inviteCoolDownHours. Implemented in Phase 7.
// func checkCoolDown(lastRemovedAt sql.NullString) error

// resolveMutualKickTieBreak would apply the tie-break rule when two members
// simultaneously kick each other. Implemented in Phase 7.
// func resolveMutualKickTieBreak(kickerJoinedAt, targetJoinedAt string) bool
