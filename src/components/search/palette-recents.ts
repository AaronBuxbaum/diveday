import { isRecentKind, MAX_RECENTS, type RecentKind } from "@/lib/recent-refs";

/**
 * **What this staffer opened from ⌘K, on this device** (fifth loop, item 13).
 * The desk reopens the same three divers all morning, so the palette opens on
 * them before anything is typed.
 *
 * A per-device convenience and nothing more: kept in this browser's storage
 * under one key per shop and per staffer, and never relied on. Storage that is
 * blocked, full or cleared reads as no recents and writes nothing. **Only which
 * record**: its kind and id. The name and detail line are read back through the
 * shop-scoped search route each time the palette opens (security review F2), so
 * nobody holding the device without a session can read a diver's contact line
 * out of it, and a record erased since stops coming back.
 */
export type StoredRecent = { key: string; kind: RecentKind; id: string };

const RECENTS_PREFIX = "diveday.palette.recent.";

export function recentsStorageKey(shopSlug: string, readerId: string | undefined): string {
  return `${RECENTS_PREFIX}${shopSlug}.${readerId ?? "anyone"}`;
}

function isStored(value: unknown): value is StoredRecent {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row);
  return (
    keys.length === 3 &&
    isRecentKind(row.kind) &&
    typeof row.id === "string" &&
    /^[\w-]+$/.test(row.id) &&
    row.key === `${row.kind}:${row.id}`
  );
}

export function readRecents(storageKey: string): StoredRecent[] {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const kept = parsed.filter(isStored);
    // An older row that carried a name or contact line leaves the device now, not at the next visit.
    if (kept.length !== parsed.length) writeRecents(storageKey, kept.slice(0, MAX_RECENTS));
    return kept.slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

function writeRecents(storageKey: string, recents: readonly StoredRecent[]): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(recents));
  } catch {
    // Storage is a convenience: a private window or a full disk keeps nothing.
  }
}

/** The newest first, one row per record, at most {@link MAX_RECENTS}. */
export function withRecent(recents: readonly StoredRecent[], record: StoredRecent): StoredRecent[] {
  return [record, ...recents.filter((row) => row.key !== record.key)].slice(0, MAX_RECENTS);
}

export function rememberRecent(storageKey: string, record: StoredRecent): void {
  const { key, kind, id } = record;
  writeRecents(storageKey, withRecent(readRecents(storageKey), { key, kind, id }));
}

/** After a read-back: keep only the records that still resolved. */
export function keepRecents(storageKey: string, keys: ReadonlySet<string>): void {
  const before = readRecents(storageKey);
  const after = before.filter((row) => keys.has(row.key));
  if (after.length !== before.length) writeRecents(storageKey, after);
}

/**
 * **Every staffer's recents on this device, gone** — what the shop-name menu's
 * own Sign out does, which knows neither the shop nor the reader the palette
 * keyed them by. A counter tablet passed between shifts keeps no names.
 */
export function forgetAllRecents(): void {
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(RECENTS_PREFIX)) keys.push(key);
    }
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    // Storage refused: nothing was kept to forget.
  }
}
