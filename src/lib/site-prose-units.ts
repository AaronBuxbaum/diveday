import type { GlobalDiveSiteBriefing } from "@/db/schema";
import { type DepthUnit, depthInUnit, depthToMeters } from "./depth-units";

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
 * - **A metric measure in prose**, "about 12 m", "a 99 m tanker", "5–9 m":
 *   converted, rounded to the whole unit (`depthInUnit`'s rule: a briefing
 *   figure, not an instrument reading).
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
        (_match, from: string, to: string | undefined) =>
          `${feet(from)}${to ? `–${feet(to)}` : ""} ft`,
      )
    : paired.replace(
        IMPERIAL,
        (_match, from: string, to: string | undefined) =>
          `${meters(from)}${to ? `–${meters(to)}` : ""} m`,
      );
}

const NUMBER = String.raw`\d+(?:\.\d+)?`;
const RANGE = String.raw`(${NUMBER})(?:\s?[–-]\s?(${NUMBER}))?`;
/** "18–40 m (60–130 ft)": both halves authored. */
const PAIR = new RegExp(
  String.raw`(${NUMBER}(?:\s?[–-]\s?${NUMBER})?)\s?m\s?\((${NUMBER}(?:\s?[–-]\s?${NUMBER})?)\s?ft\)`,
  "g",
);
/** "12 m", "5–9 m", "2.6 m": a number, then the symbol, then no more letters. */
const METRIC = new RegExp(String.raw`\b${RANGE}\s?m\b(?![²³])`, "g");
const IMPERIAL = new RegExp(String.raw`\b${RANGE}\s?ft\b`, "g");

function feet(metric: string): number {
  return Math.max(1, depthInUnit(Number(metric), "feet"));
}

function meters(imperial: string): number {
  return Math.max(1, Math.round(depthToMeters(Number(imperial), "feet")));
}

/** The briefing's prose fields: everything a diver reads that can name a measure. */
const PROSE_FIELDS = [
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
  for (const field of PROSE_FIELDS) {
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
