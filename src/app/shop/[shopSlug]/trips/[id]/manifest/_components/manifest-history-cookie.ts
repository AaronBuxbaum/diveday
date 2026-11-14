/** A per-trip, non-authorizing challenge used to correlate a server render with one return. */
const noncePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function manifestHistoryCookieName(tripId: string): string {
  return `dd-roster-${tripId}`;
}

/** Refuse ambiguous cookies rather than accepting another path's or tab's value. */
export function readManifestHistoryCookie(
  header: string | null,
  tripId: string,
): string | undefined {
  if (!header) return undefined;
  const name = manifestHistoryCookieName(tripId);
  const values = header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  if (values.length !== 1) return undefined;
  const value = values[0]?.slice(name.length + 1);
  return value && noncePattern.test(value) ? value : undefined;
}
