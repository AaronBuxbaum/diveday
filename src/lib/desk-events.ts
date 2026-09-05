import type { tripDeskEventKind } from "@/db/schema";

/**
 * **The shift catch-up strip's domain** — what the desk did, grouped into the
 * sentences a crew member reads when they come back to a departure (issues
 * #1202 and #1187, delight report D42 with D27 folded in; ADR
 * 20260904-reef-all-the-way-down, slice 16d).
 *
 * Framework-free, and **codes and names only — not one sentence**. The words
 * live in `src/i18n/desk-event-labels.ts`, which is what lets a crew read the
 * strip in their own language and what keeps `pnpm check:domain-strings` from
 * having anything to find here.
 */
export type DeskEventKind = (typeof tripDeskEventKind.enumValues)[number];

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
 * Typed as a tuple `satisfies readonly DeskEventKind[]` and read back by
 * {@link groupCatchUp} so **a kind added to the enum without a place in this
 * order is a compile error**, not a silently invisible event.
 */
export const DESK_EVENT_KINDS = [
  "arrival",
  "seat_taken",
  "seat_released",
  "gear_changed",
  "pickup_set",
  "help_request",
  "meeting_point",
  "plan_changed",
] as const satisfies readonly DeskEventKind[];

/** One desk act, as the reader's own query hands it back. */
export type DeskEvent = {
  kind: DeskEventKind;
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
  kind: DeskEventKind;
  names: readonly string[];
};

/**
 * Group a person's unread desk events into at most one line per kind.
 *
 * Three rules, each of them a thing the strip must not do:
 *
 * - **A kind with no rows contributes no group.** Nothing new means nothing
 *   renders — the strip has no empty state, because a panel saying "nothing
 *   changed" is a panel that earns nothing on a safety surface.
 * - **A name appears once inside a kind**, in the order it was first seen. A
 *   diver checked in twice is one arrival; a diver who arrived and then changed
 *   gear appears once in each of two groups and twice in neither.
 * - **Kinds come back in {@link DESK_EVENT_KINDS} order**, never in the order
 *   the desk happened to act.
 */
export function groupCatchUp(events: readonly DeskEvent[]): CatchUpGroup[] {
  const namesByKind = new Map<DeskEventKind, string[]>();
  for (const event of events) {
    const names = namesByKind.get(event.kind) ?? [];
    if (event.subjectName && !names.includes(event.subjectName)) names.push(event.subjectName);
    namesByKind.set(event.kind, names);
  }
  return DESK_EVENT_KINDS.flatMap((kind) => {
    const names = namesByKind.get(kind);
    return names ? [{ kind, names }] : [];
  });
}
