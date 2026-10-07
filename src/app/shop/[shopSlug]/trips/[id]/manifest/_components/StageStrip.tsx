"use client";

import { useActionState } from "react";
import { buttonClass } from "@/components/ui/button";
import { groupLabelClass } from "@/components/ui/ledger";
import type { TripStage } from "@/lib/trip-stages";
import type { PreDepartureCheckResult } from "../actions";

/**
 * **Where the boat is, in the crew's own word** — ADR
 * 20260904-reef-all-the-way-down, decision 2, Budget rule 4.
 *
 * Five buttons at the top of the manifest. Each tap appends; nothing here
 * edits or clears, so a crew that taps the wrong word taps the right one and
 * the newest wins.
 *
 * The manifest is a safety surface, so this carries no drawing, no coral and
 * no motion — the boat that drifts on the shop home and the storefront is
 * deliberately absent here, and `illustration.test.ts` refuses a drawing
 * import under any path containing "manifest" so the ban is structural rather
 * than remembered.
 */
export type StageStripAction = (
  prev: PreDepartureCheckResult,
  formData: FormData,
) => Promise<PreDepartureCheckResult>;

export type StageStripCopy = {
  legend: string;
  errorRefusal: string;
  /** The five taps, in the order the crew works through them. */
  taps: { stage: TripStage; label: string }[];
  /** "Keiko Tanaka · 7:04 AM", composed server-side, or undefined if nobody has said anything. */
  recordedLine?: string;
};

export function StageStrip({
  action,
  copy,
  current,
}: {
  action: StageStripAction;
  copy: StageStripCopy;
  current: TripStage | null;
}) {
  const [result, formAction, isPending] = useActionState(action, null);
  const currentLabel = copy.taps.find((tap) => tap.stage === current)?.label;
  return (
    // With no stage said there is no word to print, and the heading alone
    // printed over nothing (the day packet's eyebrow sat on the checklist
    // card): on paper the section appears only with its answer (K-141).
    <section aria-label={copy.legend} className={currentLabel ? "mt-4" : "mt-4 print:hidden"}>
      <h2 className={groupLabelClass()}>{copy.legend}</h2>
      {/* **Paper says the stage in a word; the buttons stay on screen.** The
          pressed button was the only statement of the stage, and it is a
          primary fill that print strips: the manifest printed a white label on
          white paper, a hole the width of "Boarding", and the packets, which
          hide every button, printed the eyebrow over nothing (K-141). The
          word is the crew's own, the pressed tap's label, and it prints only
          when somebody has said one; until then the whole strip stays on
          screen. */}
      {/* **Equal columns, never a ragged wrap** (UX audit 2026-10-07, item
          2). The five words were a wrapping flex row, and at 390 it broke 4 + 1:
          "Home" alone on a second line under "Boarding", a target whose
          neighbours moved every time the row reflowed, at the rail. Five
          columns do not fit a phone with a readable label in either locale
          ("Embarcando", "En superficie"), so below `sm` the row is three equal
          columns, 3 + 2, the same balance `SegmentedControl` settles a wrapped
          track into; from `sm` it is one line of five. Every target keeps its
          place whichever word is pressed.

          Not one "Next" button: on a two-tank day the word after "Surface" is
          "Underway" again as often as it is "Heading in", so a single next
          word would be wrong half the time on exactly the boats that use it
          most. */}
      <div className="mt-2 grid grid-cols-3 gap-2 sm:max-w-2xl sm:grid-cols-5 print:hidden">
        {copy.taps.map((tap) => (
          <form action={formAction} key={tap.stage} className="flex">
            <input type="hidden" name="stage" value={tap.stage} />
            <button
              type="submit"
              disabled={isPending}
              aria-busy={isPending}
              aria-pressed={current === tap.stage}
              className={buttonClass({
                variant: current === tap.stage ? "primary" : "secondary",
                // `sm`'s 14px label and 12px padding, at the dock's 56px
                // height: `boat` is the rail's size, but its 24px padding and
                // 16px label leave about 64px for a word in a third of a
                // phone, and "Underway" or "Embarcando" cannot break. The
                // height is what a wet thumb needs; `min-h-14` stands above the
                // base's `min-h-11` the way `md`'s `min-h-12` does, and
                // `touch-manipulation` is `boat`'s own (no double-tap wait).
                size: "sm",
                className: "min-h-14 w-full touch-manipulation text-balance",
              })}
            >
              {tap.label}
            </button>
          </form>
        ))}
      </div>
      {currentLabel ? (
        <p className="mt-2 hidden text-base font-semibold print:block">{currentLabel}</p>
      ) : null}
      {copy.recordedLine ? (
        <p className="mt-2 text-sm text-muted tabular-nums">{copy.recordedLine}</p>
      ) : null}
      {result && !result.ok ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {copy.errorRefusal}
        </p>
      ) : null}
    </section>
  );
}
