/**
 * **The shift catch-up strip's domain** — what the desk did, grouped into the
 * sentences a crew member reads when they come back to a departure (issues
 * #1202 and #1187, delight report D42 with D27 folded in; ADR
 * 20260904-reef-all-the-way-down, slice 16d).
 *
 * The strip reads desk lines: `activity_events` rows whose code is flagged
 * for the desk in `src/lib/activity.ts` (`catchUpKind`, issue #2701). A kind
 * here is the sentence a line feeds, not a stored value.
 *
 * Framework-free, and **codes and names only — not one sentence**. The words
 * live in `src/i18n/activity-labels.ts` (`catchUpSentences`), which is what
 * lets a crew read the strip in their own language and what keeps
 * `pnpm check:domain-strings` from having anything to find here.
 */

/**
 * **The order the strip's sentences come in**, which is not the order the desk
 * acted in.
 *
 * A crew member arriving at the rail wants the roster changes first — who is
 * here, who is on the boat now, who is not — then the day's arrangements, then
 * the two facts about the departure itself. Chronology would interleave those
 * and make the reader sort them; grouping by kind means each fact is said once,
 * with every name it is about.
 *
 * The kinds are this tuple, read back by {@link groupCatchUp}, so **a kind
 * cannot exist without a place in this order**: it is never a silently
 * invisible line.
 */
export const CATCH_UP_KINDS = [
  "arrival",
  "running_late",
  "seat_taken",
  "seat_released",
  "seat_turned_away",
  "now_diving",
  "now_snorkeling",
  "now_riding",
  "balance_owed",
  "gear_changed",
  "pickup_set",
  "help_request",
  "meeting_point",
  "plan_changed",
] as const;

/** The sentence a desk line feeds. */
export type CatchUpKind = (typeof CATCH_UP_KINDS)[number];

/** One desk line, as the reader's own query hands it back. */
export type CatchUpEvent = {
  kind: CatchUpKind;
  seq: number;
  occurredAt: Date;
  /**
   * The diver the line is about, resolved live from `people` — null for the
   * trip-wide kinds, and null for a diver whose record has been erased.
   */
  subjectName: string | null;
};

/** One sentence's worth: a kind, and every name it is about, in order. */
export type CatchUpGroup = {
  kind: CatchUpKind;
  names: readonly string[];
};

/**
 * Group a person's unread desk lines into at most one line per kind.
 *
 * Three rules, each of them a thing the strip must not do:
 *
 * - **A kind with no rows contributes no group.** Nothing new means nothing
 *   renders — the strip has no empty state, because a panel saying "nothing
 *   changed" is a panel that earns nothing on a safety surface.
 * - **A name appears once inside a kind**, in the order it was first seen. A
 *   diver checked in twice is one arrival; a diver who arrived and then changed
 *   gear appears once in each of two groups and twice in neither.
 * - **Kinds come back in {@link CATCH_UP_KINDS} order**, never in the order
 *   the desk happened to act.
 */
export function groupCatchUp(events: readonly CatchUpEvent[]): CatchUpGroup[] {
  const namesByKind = new Map<CatchUpKind, string[]>();
  for (const event of events) {
    const names = namesByKind.get(event.kind) ?? [];
    if (event.subjectName && !names.includes(event.subjectName)) names.push(event.subjectName);
    namesByKind.set(event.kind, names);
  }
  return CATCH_UP_KINDS.flatMap((kind) => {
    const names = namesByKind.get(kind);
    return names ? [{ kind, names }] : [];
  });
}
