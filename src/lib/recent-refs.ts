/**
 * **What ⌘K remembers on a device** (fifth loop, item 13; security review F2):
 * a record's kind and id, never its name or detail line. The palette asks the
 * shop-scoped search route for the words each time it opens, as
 * `?recent=diver:<id>,trip:<id>`, so nothing personal sits in the browser and
 * a record erased since simply stops coming back.
 */
export const RECENT_KINDS = ["diver", "trip", "order", "gear"] as const;
export type RecentKind = (typeof RECENT_KINDS)[number];
export type RecentRef = { kind: RecentKind; id: string };

export const MAX_RECENTS = 5;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS: ReadonlySet<string> = new Set(RECENT_KINDS);

export function isRecentKind(value: unknown): value is RecentKind {
  return typeof value === "string" && KINDS.has(value);
}

export function isRecordId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function recentParam(refs: readonly RecentRef[]): string {
  return refs.map((ref) => `${ref.kind}:${ref.id}`).join(",");
}

/** The route's reading of `?recent=`: well-formed entries only, at most {@link MAX_RECENTS}. */
export function parseRecentParam(raw: string | null): RecentRef[] {
  if (!raw) return [];
  const out: RecentRef[] = [];
  for (const entry of raw.split(",")) {
    const [kind, id, ...rest] = entry.split(":");
    if (rest.length > 0 || !isRecentKind(kind) || !isRecordId(id)) continue;
    out.push({ kind, id });
    if (out.length === MAX_RECENTS) break;
  }
  return out;
}
