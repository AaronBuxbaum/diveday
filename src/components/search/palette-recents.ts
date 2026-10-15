/**
 * **What this staffer opened from ⌘K, on this device** (fifth loop, item 13).
 * The desk reopens the same three divers all morning, so the palette opens on
 * them before anything is typed.
 *
 * A per-device convenience and nothing more: kept in this browser's storage
 * under one key per shop and per staffer, never sent anywhere, and never relied
 * on. Storage that is blocked, full or cleared reads as no recents and writes
 * nothing. Only records are kept (a diver, a departure, an order, a unit of
 * gear): the label it was opened by, its detail line and its href, which are
 * all things this staffer could already see in this shop.
 */
export type RecentKind = "diver" | "trip" | "order" | "gear";

export type RecentRecord = {
  key: string;
  kind: RecentKind;
  label: string;
  detail?: string;
  href: string;
};

export const MAX_RECENTS = 5;

const RECENTS_PREFIX = "diveday.palette.recent.";

export function recentsStorageKey(shopSlug: string, readerId: string | undefined): string {
  return `${RECENTS_PREFIX}${shopSlug}.${readerId ?? "anyone"}`;
}

const KINDS: ReadonlySet<string> = new Set(["diver", "trip", "order", "gear"]);

function isRecent(value: unknown): value is RecentRecord {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.key === "string" &&
    typeof row.label === "string" &&
    typeof row.href === "string" &&
    // A stored href is only ever a path inside this app.
    row.href.startsWith("/shop/") &&
    typeof row.kind === "string" &&
    KINDS.has(row.kind) &&
    (row.detail === undefined || typeof row.detail === "string")
  );
}

export function readRecents(storageKey: string): RecentRecord[] {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isRecent).slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

/** The newest first, one row per record, at most {@link MAX_RECENTS}. */
export function withRecent(recents: readonly RecentRecord[], record: RecentRecord): RecentRecord[] {
  return [record, ...recents.filter((row) => row.key !== record.key)].slice(0, MAX_RECENTS);
}

export function rememberRecent(storageKey: string, record: RecentRecord): void {
  try {
    const next = withRecent(readRecents(storageKey), record);
    window.localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    // Storage is a convenience: a private window or a full disk keeps nothing.
  }
}

/** Sign-out on a shared device takes this staffer's recents with it. */
export function forgetRecents(storageKey: string): void {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Nothing kept, nothing to forget.
  }
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
