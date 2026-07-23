/**
 * Bearer-capability routes whose path segment after the prefix is a
 * replayable credential, never an identifier safe to leave in telemetry.
 */
const CAPABILITY_ROUTE_PREFIXES = ["waivers", "ready", "recap"] as const;

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Rewrites `/waivers/<token>`, `/ready/<token>`, and `/recap/<token>` (and
 * any URL-encoded variant of those prefixes) to their template form so
 * Analytics/Speed Insights never receive the raw capability. Returns the
 * input unchanged for every other path.
 */
export function redactCapabilityUrl(rawUrl: string): string {
  let pathname: string;
  try {
    pathname = new URL(rawUrl, "https://redact.invalid").pathname;
  } catch {
    pathname = rawUrl.split(/[?#]/)[0] ?? rawUrl;
  }
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length < 2) return rawUrl;
  const first = decodeSegment(segments[0] ?? "").toLowerCase();
  const prefix = CAPABILITY_ROUTE_PREFIXES.find((candidate) => candidate === first);
  if (!prefix) return rawUrl;
  return `/${prefix}/[token]`;
}
