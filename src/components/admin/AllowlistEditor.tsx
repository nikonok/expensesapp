// Admin → Allowlist section (Phase 10e).
//
// Shows the sign-up allowlist: add email + optional note, list with delete.

import { useState, useEffect, useCallback } from "react";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useToast } from "@/components/shared/Toast";
import {
  listAllowlist,
  addAllowlist,
  removeAllowlist,
  type AllowlistEntry,
} from "@/services/admin/client";

export function AllowlistEditor() {
  const { show: showToast } = useToast();

  const [entries, setEntries] = useState<AllowlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [removingEmail, setRemovingEmail] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const [newEmail, setNewEmail] = useState("");
  const [newNote, setNewNote] = useState("");
  const [adding, setAdding] = useState(false);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listAllowlist();
      setEntries(list);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load allowlist", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  async function handleAdd() {
    const email = newEmail.trim();
    if (!email) return;
    setAdding(true);
    try {
      await addAllowlist(email, newNote.trim() || undefined);
      showToast("Added to allowlist", "success");
      setNewEmail("");
      setNewNote("");
      await loadEntries();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to add", "error");
    } finally {
      setAdding(false);
    }
  }

  async function handleRemoveConfirm() {
    if (!confirmRemove) return;
    const email = confirmRemove;
    setRemovingEmail(email);
    try {
      await removeAllowlist(email);
      showToast("Removed from allowlist", "success");
      setEntries((prev) => prev.filter((e) => e.email !== email));
      // Close the dialog only on success so a cancel (or error) doesn't
      // prematurely dismiss it while the network call is in flight.
      setConfirmRemove(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to remove", "error");
    } finally {
      setRemovingEmail(null);
    }
  }

  return (
    <div>
      {/* Add form */}
      <div
        style={{
          padding: "var(--space-3) var(--space-4)",
          borderBottom: "1px solid var(--color-border)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
        }}
      >
        <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
          <input
            type="email"
            placeholder="Email address"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
            disabled={adding}
            style={{
              flex: 1,
              minHeight: "40px",
              background: "var(--color-surface-raised)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-input)",
              padding: "0 var(--space-3)",
              fontFamily: '"DM Sans", sans-serif',
              fontSize: "var(--text-body)",
              color: "var(--color-text)",
              outline: "none",
            }}
          />
          <input
            type="text"
            placeholder="Note (optional)"
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            disabled={adding}
            style={{
              flex: 1,
              minHeight: "40px",
              background: "var(--color-surface-raised)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-input)",
              padding: "0 var(--space-3)",
              fontFamily: '"DM Sans", sans-serif',
              fontSize: "var(--text-body)",
              color: "var(--color-text)",
              outline: "none",
            }}
          />
          <button
            onClick={handleAdd}
            disabled={adding || newEmail.trim() === ""}
            style={{
              minHeight: "40px",
              padding: "0 var(--space-4)",
              background: "var(--color-primary)",
              color: "var(--color-bg)",
              border: "none",
              borderRadius: "var(--radius-btn)",
              fontFamily: '"DM Sans", sans-serif',
              fontWeight: 500,
              fontSize: "var(--text-body)",
              cursor: adding || newEmail.trim() === "" ? "not-allowed" : "pointer",
              opacity: adding || newEmail.trim() === "" ? 0.5 : 1,
              flexShrink: 0,
            }}
          >
            {adding ? "Adding…" : "Add"}
          </button>
        </div>
      </div>

      {/* Entry count */}
      {!loading && (
        <div
          style={{
            padding: "var(--space-2) var(--space-4)",
            fontFamily: '"DM Sans", sans-serif',
            fontSize: "var(--text-caption)",
            color: "var(--color-text-secondary)",
            borderBottom: entries.length > 0 ? "1px solid var(--color-border)" : "none",
          }}
        >
          {entries.length === 0
            ? "Allowlist is empty"
            : `${entries.length} entr${entries.length !== 1 ? "ies" : "y"}`}
        </div>
      )}

      {loading && (
        <div
          style={{
            padding: "var(--space-4) var(--space-4)",
            fontFamily: '"DM Sans", sans-serif',
            fontSize: "var(--text-body)",
            color: "var(--color-text-secondary)",
          }}
        >
          Loading…
        </div>
      )}

      {/* Entry list */}
      {entries.map((entry) => (
        <div
          key={entry.email}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            minHeight: "52px",
            padding: "0 var(--space-4)",
            borderBottom: "1px solid var(--color-border)",
            gap: "var(--space-3)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
            <span
              style={{
                fontFamily: '"DM Sans", sans-serif',
                fontWeight: 500,
                fontSize: "var(--text-body)",
                color: "var(--color-text)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {entry.email}
            </span>
            {entry.note && (
              <span
                style={{
                  fontFamily: '"DM Sans", sans-serif',
                  fontSize: "var(--text-caption)",
                  color: "var(--color-text-secondary)",
                }}
              >
                {entry.note}
              </span>
            )}
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: 2,
              flexShrink: 0,
            }}
          >
            <span
              style={{
                fontFamily: '"DM Sans", sans-serif',
                fontSize: "var(--text-caption)",
                color: "var(--color-text-secondary)",
              }}
            >
              {new Date(entry.addedAt).toLocaleDateString()}
            </span>
            {entry.addedBy && (
              <span
                style={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: "10px",
                  color: "var(--color-text-muted)",
                }}
                title={`Added by user ${entry.addedBy}`}
              >
                by {entry.addedBy.slice(0, 8)}
              </span>
            )}
          </div>

          <button
            onClick={() => setConfirmRemove(entry.email)}
            disabled={removingEmail === entry.email}
            style={{
              minHeight: "32px",
              padding: "0 var(--space-3)",
              background: "var(--color-expense-dim)",
              color: "var(--color-expense)",
              border: "1px solid oklch(62% 0.28 18 / 50%)",
              borderRadius: "var(--radius-btn)",
              fontFamily: '"DM Sans", sans-serif',
              fontWeight: 500,
              fontSize: "var(--text-caption)",
              cursor: removingEmail === entry.email ? "not-allowed" : "pointer",
              opacity: removingEmail === entry.email ? 0.5 : 1,
              flexShrink: 0,
            }}
          >
            {removingEmail === entry.email ? "Removing…" : "Remove"}
          </button>
        </div>
      ))}

      <ConfirmDialog
        isOpen={confirmRemove !== null}
        title="Remove from allowlist"
        body={`Remove ${confirmRemove} from the allowlist? They will no longer be able to sign up.`}
        confirmLabel="Remove"
        onConfirm={handleRemoveConfirm}
        onCancel={() => setConfirmRemove(null)}
        variant="destructive"
      />
    </div>
  );
}
