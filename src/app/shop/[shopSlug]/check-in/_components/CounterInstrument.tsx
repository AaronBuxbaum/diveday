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
  /** Checked in on the focused departure. */
  here: number;
  /** Everyone booked on it. */
  expected: number;
  /** Of those still to come, how many readiness will not clear yet. */
  cantBoard: number;
  /**
   * Everyone expected is here. The page decides it through
   * `allDiversCheckedIn` (`src/lib/check-in.ts`), which is the one place that
   * predicate lives — this component draws the moment, it does not define it.
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
        <p className="text-base text-muted">{figure}</p>
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
