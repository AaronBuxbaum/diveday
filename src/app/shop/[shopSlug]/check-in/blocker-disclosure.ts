import { readinessBlockerText } from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { firstSayableAtCounter, type ReadinessBlocker } from "@/lib/readiness";

/**
 * **How a blocked row at the counter says why**, in one place, because the
 * answer is a three-way call between two issues that pull in opposite
 * directions.
 *
 * `null` means render the reasons open, with no disclosure at all. A
 * `{ summary }` means put them behind that summary line.
 *
 * - One reason, and it is one a lobby may overhear → **open**. A disclosure
 *   whose collapsed and open states hold the same information, minus the
 *   information, is a door onto a room with one thing in it (issue #759).
 *   `docs/design/principles.md` §10: show the answer, not a door to it.
 * - More than one → **collapsed, but the summary names the first sayable
 *   reason** and counts the rest, so even the closed state says something a
 *   staffer can act on. Five reasons open on three rows is the scannability
 *   §9 asks for, spent.
 * - Every reason private (money, medical, a diver's age) → **collapsed, and the
 *   summary counts and says nothing else**. This is the state issue #716 put
 *   the whole list into, kept exactly, for the rows it was really about.
 *
 * Note which half of that the count-only string serves now: it is no longer
 * what a blocked row usually looks like, it is what a row looks like when
 * naming the reason would read a diver's private business to whoever is next
 * in line.
 */
export function counterBlockerDisclosure(
  t: StaffTranslator,
  blockers: readonly ReadinessBlocker[],
): { summary: string } | null {
  const sayable = firstSayableAtCounter(blockers);
  if (blockers.length === 1 && sayable) return null;
  if (sayable && blockers.length > 1) {
    return {
      summary: t("checkIn.blockerReasonsWithFirst", {
        reason: readinessBlockerText(t, sayable),
        count: blockers.length - 1,
      }),
    };
  }
  return { summary: t("checkIn.blockerReasons", { count: blockers.length }) };
}
