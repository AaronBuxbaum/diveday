import { ProgressBar } from "@/components/ui/ProgressBar";
import { CounterClearedLine } from "./CounterClearedLine";

/**
 * **The count leads** — ADR 20260827-clearwater-surface-language, decision 9.
 *
 * The counter used to answer "how many are still to come?" by making a
 * staffer read a list and subtract. The instrument answers it before the list:
 * a figure at display scale, the two remainders as quiet tabular text beside
 * it, and a 5px meter under both. Everything here is derived from the focused
 * departure's own rows — nothing is stored, and nothing on this block is a
 * control.
 *
 * **The three counts are disjoint and sum to `expected`**, which is what makes
 * the words and the meter one statement rather than two: `here` is through the
 * counter and cleared, `cantBoard` is everyone readiness refuses (checked in or
 * not), and the remainder is who has yet to walk up. They used to overlap — the
 * words said "3 to come · 2 can't board yet" over a meter drawing three bands
 * of 7, 2 and 1 — and the whole point of a figure is that nobody subtracts.
 * The page owns that arithmetic (`src/lib/check-in.ts`); this draws it.
 *
 * **Exactly one coral element, and it is not the figure.** When the last diver
 * is through, the sanctioned moment is the cleared line (decision 11's table,
 * row "The counter") — reusing the shipped `checkIn.clearedTitle` words. The
 * figure deliberately plays no settle pulse at completion: a second
 * celebration of one tap is what the coral budget exists to prevent.
 *
 * The meter is decorative and says so (`aria-hidden`): every number it draws
 * is already in the words above it.
 */
export function CounterInstrument({
  here,
  expected,
  cantBoard,
  cleared,
  figure,
  remainder,
  clearedLabel,
}: {
  /** Through the counter on the focused departure: checked in and still cleared. */
  here: number;
  /** Everyone booked on it. */
  expected: number;
  /** How many readiness will not clear — whether or not they have checked in. */
  cantBoard: number;
  /**
   * Everyone expected is here and nobody is blocked. The page decides it
   * through `counterIsClear` (`src/lib/check-in.ts`), which is the one place
   * that predicate lives — this component draws the moment, it does not define
   * it.
   */
  cleared: boolean;
  /** "7 of 10 here", already worded and wearing its own figure scale. */
  figure: React.ReactNode;
  /** "3 to come · 2 can't board yet", or nothing when nobody is left. */
  remainder: string | null;
  /** The earned line's words — rendered only when everyone expected is here. */
  clearedLabel: string;
}) {
  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        {/* Tabular on the whole phrase, not only on the leading figure: "of
            10" jitters as the count climbs otherwise, on the one number ADR
            decision 3 says should lead. */}
        <p className="text-base text-muted tabular-nums">{figure}</p>
        {remainder ? <p className="text-sm text-muted tabular-nums">{remainder}</p> : null}
      </div>
      <ProgressBar
        aria-hidden="true"
        className="mt-3 h-[5px]"
        segments={[
          { key: "here", fraction: expected > 0 ? here / expected : 0, className: "bg-success/70" },
          {
            key: "blocked",
            fraction: expected > 0 ? cantBoard / expected : 0,
            className: "bg-danger/60",
          },
        ]}
      />
      {/* Mounted whether or not the boat is clear, so the line can tell the tap
          that earned it from a page that simply loaded complete. */}
      <CounterClearedLine cleared={cleared}>{clearedLabel}</CounterClearedLine>
    </div>
  );
}
