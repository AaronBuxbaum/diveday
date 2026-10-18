import type { GlobalDiveSiteBriefing } from "@/db/schema";
import { COURSE_DEPTHS } from "./courses";
import { type DepthUnit, depthToMeters, metersToFeet } from "./depth-units";

/**
 * **A catalog briefing's measures, in the shop's own unit** (fourth review,
 * item 46).
 *
 * DiveDay's dive-site catalog is written in metres, the unit its sources
 * publish, and a shop copies it into its own row at import
 * (`importGlobalDiveSiteTemplate`). A Key Largo shop reading feet on every
 * other screen then told its divers "a ship's winch in about 12 m" under a
 * header saying "20–40 ft". Course prose solves this with placeholders
 * resolved at render (`resolveCourseContentDepths`), because a course page
 * quotes agency limits that must come from one table. A site briefing quotes
 * no limit (its ceiling is `maxDepthMeters`, compared in metres) and becomes
 * the shop's own words the moment it lands, so its measures are said in the
 * shop's unit once, at import, and the shop edits feet like anything else.
 *
 * Three shapes, the only ones the catalog uses:
 *
 * - **A pair the catalog wrote both halves of**, "18–40 m (60–130 ft)": the
 *   shop's half, as authored. A conversion would print "59–131 ft", numbers in
 *   no published source.
 * - **A metric measure in prose**, "about 12 m", "a 99 m tanker", "5–9 m",
 *   said the way a crew says it (`feet` below): a standard depth is the
 *   agency pair the course depth markers use (18 m is "60 ft", never 59), any
 *   other depth the nearest 5 ft, a length the nearest 10 ft (the Spiegel
 *   Grove is 510 ft, not 508), and a small fixture the whole foot.
 * - **An imperial one** in a metres shop's copy, the same way back.
 *
 * Only a number directly followed by the unit symbol is read, so "10 min",
 * "3 mph" and a lone "m" are never touched. Framework-free, and word-free
 * beyond the two unit symbols the catalog itself is written in.
 */
export function siteProseInUnit(text: string, unit: DepthUnit): string {
  const paired = text.replace(PAIR, (_match, metric: string, imperial: string) =>
    unit === "feet" ? `${imperial} ft` : `${metric} m`,
  );
  return unit === "feet"
    ? paired.replace(
        METRIC,
        (_match, from: string, joiner: string | undefined, to: string | undefined) =>
          `${feet(from)}${to ? `${joined(joiner)}${feet(to)}` : ""} ft`,
      )
    : paired.replace(
        IMPERIAL,
        (_match, from: string, joiner: string | undefined, to: string | undefined) =>
          `${meters(from)}${to ? `${joined(joiner)}${meters(to)}` : ""} m`,
      );
}

const NUMBER = String.raw`\d+(?:\.\d+)?`;
/**
 * What joins the two ends of a range: a dash, or the words a crew writes
 * ("30 to 33 m", "17 and 19 m", "5-to-9 m"). Both numbers convert whichever it is.
 */
const JOINER = String.raw`\s?[–-]\s?|-to-|\s(?:to|and|or)\s`;
const RANGE = `(${NUMBER})(?:(${JOINER})(${NUMBER}))?`;
/** "18–40 m (60–130 ft)": both halves authored. */
const PAIR = new RegExp(
  String.raw`(${NUMBER}(?:\s?[–-]\s?${NUMBER})?)\s?m\s?\((${NUMBER}(?:\s?[–-]\s?${NUMBER})?)\s?ft\)`,
  "g",
);
/** "12 m", "5–9 m", "2.6 m": a number, then the symbol, then no more letters. */
const METRIC = new RegExp(String.raw`\b${RANGE}\s?m\b(?![²³])`, "g");
const IMPERIAL = new RegExp(String.raw`\b${RANGE}\s?ft\b`, "g");

/** The agency pairs, by metres: the one table the course depth markers resolve through. */
const AGENCY_FEET = new Map(COURSE_DEPTHS.map((depth) => [depth.meters, depth.feet]));

/**
 * Below this a measure is a fixture (a 2.6 m statue, a 3 m propeller) and a
 * 5 ft step would be a large part of it, so it keeps the whole foot.
 */
const SMALL_METERS = 5;

/**
 * From here a measure is a length or a distance, never a depth: the catalog's
 * deepest figure is 46 m, and every hull, span and swim-out is longer than
 * that. A crew rounds those to 10 ft. A 40-something-metre tug falls on the
 * depth side and reads to 5 ft, which is still a figure someone would say.
 */
const LENGTH_METERS = 50;

/** A dash range keeps the en dash; a worded one keeps its words. */
function joined(joiner: string | undefined): string {
  return joiner && /[a-z]/i.test(joiner) ? joiner : "–";
}

function feet(metric: string): number {
  const meters = Number(metric);
  const agency = AGENCY_FEET.get(meters);
  if (agency !== undefined) return agency;
  const exact = metersToFeet(meters);
  if (meters < SMALL_METERS) return Math.max(1, Math.round(exact));
  const step = meters < LENGTH_METERS ? 5 : 10;
  const rounded = Math.round(exact / step) * step;
  // A depth deeper than an agency limit never reads at or under that limit's
  // feet: 19 m is not "60 ft". Past the limit the whole foot above it is said.
  for (const limit of COURSE_DEPTHS) {
    if (meters > limit.meters && rounded <= limit.feet) {
      return Math.max(Math.ceil(exact), limit.feet + 1);
    }
  }
  return rounded;
}

function meters(imperial: string): number {
  const exact = Number(imperial);
  const rounded = Math.max(1, Math.round(depthToMeters(exact, "feet")));
  // The same rule the other way: deeper than an agency's feet never reads at
  // or under its metres.
  for (const limit of COURSE_DEPTHS) {
    if (exact > limit.feet && rounded <= limit.meters) return limit.meters + 1;
  }
  return rounded;
}

/** The briefing's prose fields: everything a diver reads that can name a measure. */
export const SITE_PROSE_FIELDS = [
  "description",
  "marineLifeDescription",
  "conservationNote",
  "depthRange",
  "currentNote",
  "divePlan",
  "fitNote",
] as const satisfies readonly (keyof GlobalDiveSiteBriefing)[];

/**
 * A published briefing with every measure in `unit`: what the shop imports,
 * and what the template-update merge compares its row against, so a shop's
 * feet never read as an edit of the catalog's metres.
 */
export function briefingInUnit(
  briefing: GlobalDiveSiteBriefing,
  unit: DepthUnit,
): GlobalDiveSiteBriefing {
  const resolved: GlobalDiveSiteBriefing = { ...briefing };
  for (const field of SITE_PROSE_FIELDS) {
    const text = briefing[field];
    if (typeof text === "string") resolved[field] = siteProseInUnit(text, unit);
  }
  if (briefing.landmarks) {
    resolved.landmarks = briefing.landmarks.map((landmark) => ({
      ...landmark,
      note: siteProseInUnit(landmark.note, unit),
    }));
  }
  return resolved;
}
