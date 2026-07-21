// Last-Write-Wins (LWW) merge for sync conflict resolution.
// Architecture §7.6 (as amended): the sync engine's only supported
// `updatedAtMap` shape is the sentinel `{ _all: <ISO-8601-ms> }` — a single
// timestamp for the whole record, produced by every `push-helpers.ts`
// helper. When both sides carry `_all`, this is WHOLE-RECORD LWW: the newer
// side's entire payload wins outright, with editedByUserId as the tie-break.
// There is no field-level merge in that path — `_all` is a sentinel key, not
// an actual payload field, so it must never be looked up on the payloads
// themselves.
//
// The legacy per-field loop below is kept for defensiveness (e.g. records
// migrated from an older client build that shipped genuine per-field maps)
// but is not exercised by any current write path.

/**
 * Merge two plaintext JSON payloads using LWW semantics.
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
  if ("_all" in localMap || "_all" in serverMap) {
    return mergeWholeRecord(
      localPayload,
      serverPayload,
      localMap._all,
      serverMap._all,
      localEditorId,
      serverEditorId,
    );
  }
  return mergePerField(
    localPayload,
    serverPayload,
    localMap,
    serverMap,
    localEditorId,
    serverEditorId,
  );
}

/** Compares two ISO-8601 timestamps numerically (NaN parses as -Infinity so
 *  a well-formed timestamp always beats a malformed one). */
function compareTimestamps(a: string | undefined, b: string | undefined): number {
  const aMs = a ? new Date(a).getTime() : NaN;
  const bMs = b ? new Date(b).getTime() : NaN;
  const aTime = Number.isNaN(aMs) ? -Infinity : aMs;
  const bTime = Number.isNaN(bMs) ? -Infinity : bMs;
  return aTime - bTime;
}

function mergeWholeRecord(
  localPayload: Record<string, unknown>,
  serverPayload: Record<string, unknown>,
  localTs: string | undefined,
  serverTs: string | undefined,
  localEditorId: string,
  serverEditorId: string,
): { mergedPayload: Record<string, unknown>; mergedMap: Record<string, string> } {
  const cmp = compareTimestamps(localTs, serverTs);
  let winnerIsLocal: boolean;
  if (cmp > 0) winnerIsLocal = true;
  else if (cmp < 0) winnerIsLocal = false;
  else winnerIsLocal = localEditorId > serverEditorId; // tie-break

  const winningTs = winnerIsLocal ? localTs : serverTs;
  return {
    mergedPayload: winnerIsLocal ? { ...localPayload } : { ...serverPayload },
    mergedMap: { _all: winningTs ?? new Date().toISOString() },
  };
}

function mergePerField(
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

    const cmp = compareTimestamps(localTs, serverTs);
    if (cmp > 0) {
      mergedPayload[field] = localPayload[field];
      mergedMap[field] = localTs;
    } else if (cmp < 0) {
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
