/**
 * **What the reef was like last time** (fifth-loop ideas, item 6).
 *
 * Every executed dive records the site actually dived and what the crew saw
 * (`executed_dives.observed_conditions`), and until this nothing read them
 * again except that departure's own log. The plan now says, for each site it
 * names, the newest of two facts from an earlier departure:
 *
 * - **dived**: the boat was last on this site on that day, with the crew's
 *   own visibility and current, in their words;
 * - **moved**: the last time this site was planned, the boat went elsewhere,
 *   which is the captain's memory a plan most needs.
 *
 * A site never dived says nothing. Codes and the crew's own words only; the
 * sentence is the surface's (`siteHistoryText`, `src/i18n/site-history-labels.ts`).
 */

/** One earlier executed dive, as the reader returns it. */
export type SiteHistoryRecord = {
  /** When the dive went in, or the departure's start when nobody wrote the time. */
  divedAt: Date;
  recordedByName: string | null;
  /** The crew's own words, trimmed; null when they wrote none. */
  visibility: string | null;
  current: string | null;
  /** Where the boat actually went: this site, or another for a move. */
  actualSiteName: string;
};

export type SiteHistory =
  | ({ kind: "dived" } & SiteHistoryRecord)
  | ({ kind: "moved" } & SiteHistoryRecord);

/**
 * The newer of the two facts, or null for a site with no history. On a tie
 * the dive wins: a boat that went there that day was there.
 */
export function siteHistoryOf(input: {
  dived: SiteHistoryRecord | null;
  movedAway: SiteHistoryRecord | null;
}): SiteHistory | null {
  const { dived, movedAway } = input;
  if (movedAway && (!dived || movedAway.divedAt > dived.divedAt)) {
    return { kind: "moved", ...movedAway };
  }
  return dived ? { kind: "dived", ...dived } : null;
}

/** A free-text condition the crew typed, or null when it says nothing. */
export function observedWords(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const words = value.trim();
  return words.length > 0 ? words : null;
}
