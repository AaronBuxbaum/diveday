/**
 * Which drawing marks a departure — Reef's site mark (ADR
 * 20260901-diveday-reimagined, decision 1, slice 13f).
 *
 * Reef draws in one hand, and a departure's marker on the home spine and the
 * week board is the first place that hand appears in the product. Four of the
 * set's six drawings stand for a departure: the brain coral for a reef, the
 * wreck for a wreck, the sea fan for a course session (taught, whatever the
 * site), and the bubble trail for open water or a site nobody has named yet.
 *
 * A site carries no "kind" column — its briefing is the shop's own words
 * (ADR 20260813-dive-site-briefings-are-the-shops-own-words) — so the mark
 * reads the site's *name*, the way `siteFit()` reads a briefing for its tone.
 * A miss costs nothing: the bubble trail is the honest default, and the mark
 * is decoration beside a time and a title that carry the fact.
 */
export const SITE_MARKS = ["reef", "wreck", "course", "open"] as const;
export type SiteMarkCode = (typeof SITE_MARKS)[number];

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
