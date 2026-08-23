import { readinessBlockerText } from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { ReadinessBlocker } from "@/lib/readiness";

/**
 * **How a blocked row at the counter says why.**
 *
 * `null` means render the reason open, with no disclosure at all. A
 * `{ summary }` means put the rest behind that summary line.
 *
 * - One reason → **open**. A disclosure whose collapsed and open states hold
 *   the same information, minus the information, is a door onto a room with
 *   one thing in it (issue #759). `docs/design/principles.md` §10: show the
 *   answer, not a door to it.
 * - More than one → **collapsed, but the summary names the worst reason**
 *   (the readiness engine's own order) and counts the rest, so even the
 *   closed state says something a staffer can act on.
 *
 * Issue #716 raised naming money, a medical hold, or a diver's age on this
 * screen; #890 settled it — the counter is a staff surface like any other, so
 * it says what every other blocked row says, even the ones it used to
 * withhold.
 */
export function counterBlockerDisclosure(
  t: StaffTranslator,
  blockers: readonly ReadinessBlocker[],
): { summary: string } | null {
  if (blockers.length <= 1) return null;
  return {
    summary: t("checkIn.blockerReasonsWithFirst", {
      reason: readinessBlockerText(t, blockers[0]),
      count: blockers.length - 1,
    }),
  };
}
