"use client";

import Link from "next/link";
import { useActionState } from "react";
import { BOAT_SEGMENT_TRACK_CLASS, boatSegmentClass } from "@/components/boat-segments";
import { buttonClass } from "@/components/ui/button";
import { groupLabelClass } from "@/components/ui/group-label";
import { isHomewardStage } from "@/lib/checkpoint-gaps";
import type { TripStage } from "@/lib/trip-stages";
import type { TripStageResult } from "../actions";

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
  prev: TripStageResult,
  formData: FormData,
) => Promise<TripStageResult>;

export type StageStripCopy = {
  legend: string;
  errorRefusal: string;
  /**
   * The five taps, in the order the crew works through them. `shortLabel` is
   * the word a phone shows; the full label stays the accessible name.
   */
  taps: { stage: TripStage; label: string; shortLabel: string }[];
  /** "Keiko Tanaka · 7:04 AM", composed server-side, or undefined if nobody has said anything. */
  recordedLine?: string;
  /**
   * The last after-dive roll call still has somebody unmarked (batch 6, item
   * 4; `homewardCheckpointGap`): the line and the one tap to it. Said only
   * once the boat's word is "Heading in" or "Home" — before that, the count
   * is simply not due yet.
   *
   * `plan`: the last dive has no result for anybody and the one before is
   * closed (`not_counted`), so the line asks whether the dive was called off
   * and this is the way to the dive count, beside the roll call.
   */
  rollCallOpen?: {
    line: string;
    openLabel: string;
    href: string;
    plan?: { label: string; href: string };
  };
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
  // The server reports it with the tap and the page says it from its own read;
  // either is enough, so the warning does not wait on the re-render.
  const homeward =
    (current !== null && isHomewardStage(current)) || (result?.ok && result.rollCallOpen);
  const rollCallOpen = homeward ? copy.rollCallOpen : undefined;
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
      {/* **One row of five, the checkpoint switch's own control** (visual
          review 2026-10-24, B06; `boat-segments.ts`). The words used to wrap
          3 + 2 as outline buttons above a differently drawn Dock / Dive 1 /
          Dive 2 track: two selectors one above the other in two idioms. A
          phone takes the short word, and a row still too wide scrolls inside
          its track; every target keeps its place whichever word is pressed.

          Not one "Next" button: on a two-tank day the word after "Surface" is
          "Underway" again as often as it is "Heading in", so a single next
          word would be wrong half the time on exactly the boats that use it
          most. */}
      <div className={`mt-2 ${BOAT_SEGMENT_TRACK_CLASS}`}>
        {copy.taps.map((tap) => (
          <form action={formAction} key={tap.stage} className="flex">
            <input type="hidden" name="stage" value={tap.stage} />
            <button
              type="submit"
              disabled={isPending}
              aria-busy={isPending}
              aria-pressed={current === tap.stage}
              className={`w-full ${boatSegmentClass(current === tap.stage)}`}
            >
              <span aria-hidden="true" className="sm:hidden">
                {tap.shortLabel}
              </span>
              <span className="max-sm:sr-only">{tap.label}</span>
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
      {rollCallOpen ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 print:hidden">
          <p role="status" className="text-base font-bold text-danger">
            {rollCallOpen.line}
          </p>
          <Link
            href={rollCallOpen.href}
            scroll={false}
            className={buttonClass({ variant: "primary", size: "boat" })}
          >
            {rollCallOpen.openLabel}
          </Link>
          {rollCallOpen.plan ? (
            <Link
              href={rollCallOpen.plan.href}
              className={buttonClass({ variant: "secondary", size: "boat" })}
            >
              {rollCallOpen.plan.label}
            </Link>
          ) : null}
        </div>
      ) : null}
      {result && !result.ok ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {copy.errorRefusal}
        </p>
      ) : null}
    </section>
  );
}
