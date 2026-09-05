import type { CatchUpGroup, DeskEventKind } from "@/lib/desk-events";
import { cachedListFormat } from "@/lib/intl-cache";
import type { StaffTranslator } from "./staff-messages";

/**
 * The catch-up strip's sentences (issues #1202 and #1187, delight report D42).
 *
 * `src/lib/desk-events.ts` returns codes and names and stops there; this is
 * where the words are chosen — the same split `birthday-labels.ts` follows, and
 * the reason a crew reading Spanish sees Spanish rather than an English row
 * with a translated label on top of it.
 */
const KEYS = {
  arrival: "manifest.catchUp.arrival",
  seat_taken: "manifest.catchUp.seatTaken",
  seat_released: "manifest.catchUp.seatReleased",
  gear_changed: "manifest.catchUp.gearChanged",
  pickup_set: "manifest.catchUp.pickupSet",
  help_request: "manifest.catchUp.helpRequest",
  meeting_point: "manifest.catchUp.meetingPoint",
  plan_changed: "manifest.catchUp.planChanged",
} as const satisfies Record<DeskEventKind, string>;

/**
 * One sentence per group, in the order {@link groupCatchUp} put them.
 *
 * The two trip-wide kinds take no names and say the fact plainly; every other
 * kind interpolates its names through `Intl.ListFormat` in the reader's own
 * locale — never a hand-rolled `", "`, which puts an English "and" into a
 * Spanish sentence.
 *
 * A group whose names all resolved to null — every diver on it erased — is
 * dropped rather than rendered as an empty list. That is the honest outcome of
 * joining the name live: an erasure takes the line with it.
 */
export function catchUpSentences(
  t: StaffTranslator,
  locale: string,
  groups: readonly CatchUpGroup[],
): string[] {
  const list = cachedListFormat(locale, { type: "conjunction" });
  return groups.flatMap((group) => {
    if (group.kind === "meeting_point" || group.kind === "plan_changed") {
      return [t(KEYS[group.kind])];
    }
    if (group.names.length === 0) return [];
    return [t(KEYS[group.kind], { count: group.names.length, names: list.format(group.names) })];
  });
}
