// Per-field Last-Write-Wins (LWW) merge for sync conflict resolution.
// Architecture §7.6: for each field, the timestamp in updatedAtMap determines
// which side wins. On a tie, lexicographic compare of editedByUserId breaks it.

/**
 * Merge two plaintext JSON payloads using per-field LWW semantics.
 *
 * @param localPayload   - Parsed plaintext from the local record.
 * @param serverPayload  - Parsed plaintext from the server's current blob.
 * @param localMap       - updatedAtMap for the local record (field → ISO-8601-ms).
 * @param serverMap      - updatedAtMap from the server's conflict response.
 * @param localEditorId  - editedByUserId for the local version (tie-break).
 * @param serverEditorId - editedByUserId for the server version (tie-break).
 * @returns Merged payload and the merged updatedAtMap.
 */
export function mergePayloads(
  localPayload: Record<string, unknown>,
  serverPayload: Record<string, unknown>,
  localMap: Record<string, string>,
  serverMap: Record<string, string>,
  localEditorId: string,
  serverEditorId: string,
): { mergedPayload: Record<string, unknown>; mergedMap: Record<string, string> } {
  const allKeys = new Set([...Object.keys(localMap), ...Object.keys(serverMap)]);
  const mergedPayload: Record<string, unknown> = { ...serverPayload };
  const mergedMap: Record<string, string> = { ...serverMap };

  for (const field of allKeys) {
    const localTs = localMap[field];
    const serverTs = serverMap[field];

    if (!localTs && !serverTs) continue;

    if (!localTs) {
      // Server has this field; server wins by default — already in mergedPayload.
      continue;
    }

    if (!serverTs) {
      // Local has this field; local wins.
      mergedPayload[field] = localPayload[field];
      mergedMap[field] = localTs;
      continue;
    }

    // Both sides have a timestamp — compare.
    if (localTs > serverTs) {
      mergedPayload[field] = localPayload[field];
      mergedMap[field] = localTs;
    } else if (serverTs > localTs) {
      // Server wins — already in mergedPayload.
    } else {
      // Exact tie — break by editedByUserId lexicographic order.
      if (localEditorId > serverEditorId) {
        mergedPayload[field] = localPayload[field];
        mergedMap[field] = localTs;
      }
      // else server wins — already in mergedPayload.
    }
  }

  return { mergedPayload, mergedMap };
}
