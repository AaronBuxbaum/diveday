import { SettledCheck } from "@/components/ui/SettledCheck";

/**
 * **The waiver's step rail** — ADR 20260827-the-divers-thread, decision 5
 * (slice 7e): "the three steps stand under a quiet step rail (Release ·
 * Medical · Sign) that says where you are".
 *
 * The page it sits on is a wall by construction: a full legal release, then
 * eleven medical questions, then a signature — a thousand pixels of scroll
 * before the diver reaches anything they can finish, with nothing anywhere
 * saying how much of it is behind them. The rail is that one sentence, and it
 * is deliberately *only* that sentence: three marks, three words, and a count.
 *
 * Three rules it keeps, each of which a reviewer should be able to check in
 * one read:
 *
 * - **It is not a navigator on first pass.** The segments are plain text until
 *   a refusal names a field one of them owns, and only then does that one
 *   segment become an anchor back to it — which is the moment it is worth
 *   having, because a refused submit lands the reader at the top of the page
 *   and the thing to fix is hundreds of pixels down. Nothing here ever links
 *   *forward*: a diver cannot skip the release by tapping "Sign".
 * - **It says nothing about medical outcomes.** The count is steps, never
 *   answers, and no segment carries a clearance judgment — the waiver and
 *   medical wording freeze (H-01/H-03) covers every word on this page, and
 *   `QuestionnaireOutcome` is the one place that speaks about answers at all.
 *   Declining to settle a step is not a judgment about it: the rail is told a
 *   step is still open and draws an open ring, and the page above it is what
 *   says why.
 * - **Shape and words, never colour alone.** `SettledCheck` is Clearwater's
 *   settle mark (drawn, never an emoji) and it differs by *shape* — a filled
 *   check against an open ring — before it differs by ink; the rail's own
 *   "N of 3 done" states the aggregate in words beside it. The rail is
 *   therefore readable with no colour perception at all.
 *
 * Presentational and framework-free apart from the mark: {@link WaiverPacing}
 * computes the live state from the questionnaire's own radios and hands it
 * over, and the completed state renders this directly from the server — at 3 of
 * 3, or at 2 with Medical still open when the record is on a hold. That split
 * is what lets `WaiverStepRail.test.tsx` pin the counting rule without a
 * database, a token or a browser.
 */

/** The rail's own hook, named here so a spec and a test cannot drift from it. */
export const WAIVER_RAIL_TEST_ID = "waiver-step-rail";

/** Three segments, always — the denominator of "N of 3 done". */
export const WAIVER_RAIL_TOTAL = 3;

export type WaiverRailSegmentId = "release" | "medical" | "sign";

/** The three segments in the order a diver walks them. Never re-ordered. */
export const WAIVER_RAIL_ORDER = ["release", "medical", "sign"] as const;

export type WaiverRailProgress = {
  release: boolean;
  medical: boolean;
  sign: boolean;
  /** How many of the three have settled — always 0…3, always reachable. */
  done: number;
};

/**
 * **The counting rule**, written once so the rail, the tests and the completed
 * state cannot each invent their own.
 *
 * - **Release** settles once any medical answer exists in the draft. There is
 *   no "I have read this" control on the release — presenting the full text is
 *   what typed consent means here, and a checkbox claiming otherwise would be
 *   a legal posture change rather than a design one — so the honest evidence
 *   that a diver has moved past it is that they have started answering the
 *   questions underneath it.
 * - **Medical** settles when nothing the diver was handed is left blank — and
 *   the questions their own answers put on the page count. `medicalTotal`
 *   deliberately stays the page-one list, because a *denominator* that grows
 *   when you answer honestly is a rail that punishes honesty; the **settle
 *   mark** is not that ratio. Ticking Medical over an open Box would have the
 *   rail contradicting the outcome line under the questions ("answer those and
 *   you're done") and the submit that is about to be refused, three inches
 *   apart on one form.
 * - **Sign** settles only on the completed state. A typed name and a ticked
 *   box are not a signature until `completeWaiver` has accepted them, and
 *   nothing on this page may say otherwise.
 *
 * `medicalTotal <= 0` cannot settle Medical on its own — an empty
 * questionnaire is a bug, and a rail cheerfully reporting "2 of 3 done"
 * against zero questions would hide it.
 */
export function waiverRailProgress(input: {
  /** Page-one questions answered so far, from the draft or the live form. */
  medicalAnswered: number;
  /** How many page-one questions this jurisdiction's form asks. */
  medicalTotal: number;
  /**
   * Questions that are on the page only because of an answer the diver gave,
   * and are still blank. Zero on a form nobody has opened one on.
   */
  medicalFollowUpsRemaining?: number;
  /**
   * The caller knows this step has not closed, whatever the answers add up to.
   * Only the completed state passes it, reading the record's own status: the
   * rail declines to settle the segment and says nothing whatever about why,
   * which is the job of the page above it. A settled check beside a step the
   * shop is still holding open is the product ticking its own blocking state.
   */
  medicalStillOpen?: boolean;
  /** The waiver is signed and on file. */
  signed: boolean;
}): WaiverRailProgress {
  const release = input.signed || input.medicalAnswered > 0;
  const medical =
    !input.medicalStillOpen &&
    (input.signed ||
      (input.medicalTotal > 0 &&
        input.medicalAnswered >= input.medicalTotal &&
        (input.medicalFollowUpsRemaining ?? 0) === 0));
  const sign = input.signed;
  return {
    release,
    medical,
    sign,
    done: [release, medical, sign].filter(Boolean).length,
  };
}

export function WaiverStepRail({
  progress,
  labels,
  doneLabel,
  anchors,
  className = "",
}: {
  progress: WaiverRailProgress;
  /** The three segment names in the diver's own language, already resolved. */
  labels: Record<WaiverRailSegmentId, string>;
  /** "2 of 3 done", already filled and pluralised by the caller. */
  doneLabel: string;
  /**
   * Same-page anchors, populated **only** for a segment a refusal has just
   * named. An empty bag — the ordinary case — renders a rail with no links in
   * it at all.
   */
  anchors?: Partial<Record<WaiverRailSegmentId, string>>;
  className?: string;
}) {
  return (
    // Hairlines on the page background, no card and no fill: this is a line of
    // orientation, not a panel (ADR 20260827-clearwater-surface-language —
    // elevation is earned, and a rail that floats is a rail competing with the
    // release it introduces).
    //
    // Deliberately not a live region. The sticky questionnaire counter below
    // already announces its running count politely, and a second region
    // re-announcing "1 of 3 done" on the same keystroke is two interruptions
    // for one fact.
    <div
      data-testid={WAIVER_RAIL_TEST_ID}
      className={`flex flex-wrap items-center gap-x-5 gap-y-1 border-y border-border py-3 ${className}`.trim()}
    >
      <ol className="flex flex-wrap items-center gap-x-5 gap-y-1">
        {WAIVER_RAIL_ORDER.map((id) => {
          const anchor = anchors?.[id];
          const mark = (
            <SettledCheck
              settled={progress[id]}
              label={labels[id]}
              className="text-sm font-medium"
            />
          );
          return (
            <li key={id} data-rail-step={id} className={progress[id] ? "" : "text-muted"}>
              {anchor ? (
                <a
                  href={`#${anchor}`}
                  className="inline-flex min-h-11 items-center text-primary underline underline-offset-4 hover:no-underline"
                >
                  {mark}
                </a>
              ) : (
                mark
              )}
            </li>
          );
        })}
      </ol>
      <span className="ms-auto text-sm text-muted tabular-nums">{doneLabel}</span>
    </div>
  );
}
