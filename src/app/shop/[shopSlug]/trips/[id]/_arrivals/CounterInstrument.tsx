import { ReadinessBar } from "@/components/ui/ProgressBar";
import { CounterClearedLine } from "./CounterClearedLine";

/**
 * **The desk's bar** (ADR 20260827-clearwater-surface-language, decision 9;
 * ADR 20261117-trip-page-clock): here, can't board, and to come, as one 8px
 * meter under the Check-in sentence, which already says the count in words
 * ("2 of 11 here"). Everything is derived from the departure's own rows;
 * nothing here is a control.
 *
 * **The three counts are disjoint and sum to `expected`**: `here` is through
 * the counter and cleared, `cantBoard` is everyone readiness refuses (checked
 * in or not), and the remainder is who has yet to walk up. The page owns that
 * arithmetic (`src/lib/check-in.ts`); this draws it.
 *
 * **Exactly one earned moment**: when the last guest is through, the cleared
 * line (decision 11's table, row "The counter"). The meter is decorative and
 * says so (`aria-hidden`).
 */
export function CounterInstrument({
  here,
  expected,
  cantBoard,
  cleared,
  clearedLabel,
}: {
  /** Through the counter on the focused departure: checked in and still cleared. */
  here: number;
  /** Everyone booked on it. */
  expected: number;
  /** How many readiness will not clear — whether or not they have checked in. */
  cantBoard: number;
  /**
   * Everyone expected is here and nobody is blocked, decided by
   * `counterIsClear` (`src/lib/check-in.ts`); this draws the moment.
   */
  cleared: boolean;
  /** The earned line's words — rendered only when everyone expected is here. */
  clearedLabel: string;
}) {
  return (
    <div>
      {/* Today's bar, at Today's 8px and full tints (#2100). */}
      <ReadinessBar ready={here} blocked={cantBoard} of={expected} />
      {/* Mounted whether or not the boat is clear, so the line can tell the tap
          that earned it from a page that simply loaded complete. */}
      <CounterClearedLine cleared={cleared}>{clearedLabel}</CounterClearedLine>
    </div>
  );
}
