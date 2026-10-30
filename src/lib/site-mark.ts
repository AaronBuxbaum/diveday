import { utcToWallTime } from "./zoned";

/**
 * Reef's decorative departure mark (ADR 20260901-diveday-reimagined, decision
 * 1, slice 13f). The parrotfish marks reef trips, the sea fan course sessions,
 * and the bubble trail open water or names the heuristic cannot match. The
 * wreck drawing was added for Key Largo wreck charters. Brain coral marks a
 * site without its own photo; the turtle marks the morning all-clear.
 *
 * Sites have no kind column (ADR
 * 20260813-dive-site-briefings-are-the-shops-own-words). `siteMarkFor` is a
 * name heuristic: courses take precedence, then selected wreck and reef words
 * match; every other name, including "Spiegel Grove", uses `open`. The mark is
 * decorative; the trip's title and time carry the facts.
 */
export const SITE_MARKS = ["reef", "wreck", "course", "open"] as const;
export type SiteMarkCode = (typeof SITE_MARKS)[number];

/** Every drawing in the hand that renders as a tile; the swell is the sixth. */
/**
 * The hand's whole vocabulary. The eighth is the **boat** (ADR
 * 20260904-reef-all-the-way-down, decision 2, Budget rule 2): the one drawing
 * that ever moves, and the one the crew's own word is drawn beside. It appears
 * on the shop home, the schedule board and the storefront, and **never on the
 * manifest** — `illustration.test.ts` refuses a drawing import under any path
 * containing "manifest", so that ban is structural rather than remembered.
 *
 * A boat is not a `SITE_MARK`: a site mark is derived from a site's *name*,
 * and the boat is chosen by a surface that knows a boat is out.
 */
export const REEF_DRAWINGS = [...SITE_MARKS, "site", "turtle", "boat"] as const;
export type ReefDrawingCode = (typeof REEF_DRAWINGS)[number];

const WRECK = /wreck|\b(ship|hull|barge|tug|freighter|tanker|schooner|cutter|uscgc?)\b/i;
const REEF =
  /\b(reef|coral|garden|gardens|ledge|wall|ridge|rock|rocks|pinnacle|cay|key|bank|shoal|shoals|patch)\b/i;

export function siteMarkFor(facts: { siteName: string | null; isCourse?: boolean }): SiteMarkCode {
  if (facts.isCourse) return "course";
  const name = facts.siteName?.trim() ?? "";
  if (!name) return "open";
  if (WRECK.test(name)) return "wreck";
  if (REEF.test(name)) return "reef";
  return "open";
}

/**
 * The tile's ground for a departure at this hour: the lagoon wash by day, and
 * the deep — the wash and the ink swapped — for a boat that leaves after dark,
 * so the night dive reads as night at a glance (the home board flips its
 * 7:30 PM station). Six in the evening to five in the morning, wall time in
 * the shop's zone: a rule about *when the boat leaves*, never a sunset table,
 * because a 6 PM departure in December is a night dive by the time it is in
 * the water and a 6 PM one in June is not, and the tile is decoration either
 * way — the time beside it is the fact.
 */
export function siteMarkGroundFor(startsAt: Date, timeZone: string): "tint" | "deep" {
  const { hour } = utcToWallTime(startsAt, timeZone);
  return hour >= 18 || hour < 5 ? "deep" : "tint";
}
