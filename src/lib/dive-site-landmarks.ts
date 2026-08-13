/**
 * The named things a crew points at underwater, as the shop wrote them down.
 *
 * These used to be half shop-owned and half DiveDay's: the *names* came off the
 * site row (`dive_sites.landmarks`, a list of strings), and the paragraph under
 * each one came from a lookup table in this file keyed by site name and
 * landmark name. So "Molasses Reef" + "Molasses Reef Light" had a sentence
 * about staying oriented around the central reef, and every landmark any real
 * shop typed fell through to one generic line — a shop could name its landmarks
 * and could never say anything about them. Worse, the seven that did have copy
 * were unreachable: rename the site and the paragraph silently vanished.
 *
 * A landmark is now a record with its own words on it. `kind` stays a code —
 * it is a category with a translated label, the same shape a readiness status
 * has — and `note` is the shop's own prose, in the shop's own language,
 * rendered as typed.
 */

/**
 * The categorical "type" of a named landmark — a code, not a rendered word.
 * `pointOfInterest` is the fallback for a landmark whose kind was never chosen.
 */
export type DiveSiteLandmarkKind =
  | "navigationMark"
  | "reefHistory"
  | "wreckFeature"
  | "underwaterMonument"
  | "reefFormation"
  | "pointOfInterest";

export const DIVE_SITE_LANDMARK_KINDS: readonly DiveSiteLandmarkKind[] = [
  "pointOfInterest",
  "navigationMark",
  "reefFormation",
  "reefHistory",
  "wreckFeature",
  "underwaterMonument",
];

/** One landmark as it is stored on the site row and rendered on a briefing. */
export type DiveSiteLandmark = {
  name: string;
  kind: DiveSiteLandmarkKind;
  /** The shop's own sentence about it. Empty means the briefing says nothing extra. */
  note: string;
};

/** The most landmarks one site may carry — a briefing, not a gazetteer. */
export const MAX_SITE_LANDMARKS = 8;

const MAX_LANDMARK_NAME = 80;
const MAX_LANDMARK_NOTE = 400;

function isKind(value: unknown): value is DiveSiteLandmarkKind {
  return (
    typeof value === "string" && (DIVE_SITE_LANDMARK_KINDS as readonly string[]).includes(value)
  );
}

/**
 * Landmarks from anywhere untrusted — a form post, an imported template, a row
 * written before landmarks carried anything but a name — reduced to the shape
 * every renderer can assume.
 *
 * A bare string is a legitimate input, not a legacy quirk to migrate away: that
 * is exactly what `dive_sites.landmarks` held until this change, and what the
 * CSV import still accepts. It reads as a landmark with a name, no chosen kind,
 * and nothing said about it — which is what those rows meant.
 *
 * Never throws: anything unusable is dropped, and an empty list is the ordinary
 * answer for most sites.
 */
export function parseDiveSiteLandmarks(raw: unknown): DiveSiteLandmark[] {
  const list = typeof raw === "string" ? safeJson(raw) : raw;
  if (!Array.isArray(list)) return [];
  const landmarks: DiveSiteLandmark[] = [];
  for (const entry of list) {
    if (landmarks.length >= MAX_SITE_LANDMARKS) break;
    if (typeof entry === "string") {
      const name = entry.trim().slice(0, MAX_LANDMARK_NAME);
      if (name) landmarks.push({ name, kind: "pointOfInterest", note: "" });
      continue;
    }
    if (typeof entry !== "object" || entry === null) continue;
    const { name, kind, note } = entry as { name?: unknown; kind?: unknown; note?: unknown };
    if (typeof name !== "string") continue;
    const trimmed = name.trim().slice(0, MAX_LANDMARK_NAME);
    if (!trimmed) continue;
    landmarks.push({
      name: trimmed,
      kind: isKind(kind) ? kind : "pointOfInterest",
      note: typeof note === "string" ? note.trim().slice(0, MAX_LANDMARK_NOTE) : "",
    });
  }
  return landmarks;
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
