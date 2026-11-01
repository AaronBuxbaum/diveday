/**
 * **The waiver's step rail** — ADR 20260827-the-divers-thread, decision 5
 * (slice 7e): "the three steps stand under a quiet step rail (Release ·
 * Medical · Sign) that says where you are".
 *
 * The page it sits on is a wall by construction: a full legal release, then
 * eleven medical questions, then a signature — a thousand pixels of scroll
 * before the diver reaches anything they can finish, with nothing anywhere
 * saying how much of it is behind them. The rail is that one sentence, and it
 * is deliberately *only* that sentence: the step names, the current one bold, and a count.
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
 *   medical wording freeze (H-20260730-jurisdiction-waiver-text-medical/H-20260724-current-typed-name-explicit) covers every word on this page, and
 *   `QuestionnaireOutcome` is the one place that speaks about answers at all.
 *   Declining to settle a step is not a judgment about it: the rail is told a
 *   step is still open and draws an open ring, and the page above it is what
 *   says why.
 * - **Weight and words, never colour alone.** Since the visual review of
 *   2026-10-24 (B56) the rail is one progress line, "Release · Medical ·
 *   Questions · Sign", with no marks: the step the diver is on is bold and
 *   `aria-current="step"`, and the rail's own "N of 3 done" states the
 *   aggregate in words beside it. The radio-style rings read as controls on
 *   a page full of real radios.
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

/**
 * Three segments on a release that asks only DiveDay's questions — the
 * denominator of "N of 3 done". A shop that adds its own questions (glossary
 * *Shop question*) gives the rail a fourth, **Questions**, between Medical and
 * Sign, and only then: a step nobody is asked is not a step.
 */
export const WAIVER_RAIL_TOTAL = 3;

export type WaiverRailSegmentId = "release" | "medical" | "questions" | "sign";

/**
 * **The rail becomes a navigator only after a refusal**, and only for the one
 * segment that owns the refused field. A refused submit lands the reader back
 * at the top of a page whose problem is several hundred pixels down, and the
 * rail is the thing already sitting there. Nothing ever links *forward*: a
 * diver cannot tap "Sign" to skip the release. The medical alert for the crew
 * sits beside the questionnaire, so its refusal points at Medical, the step it
 * is not part of (issue #2960).
 */
export function refusalRailAnchors({
  refusedAnchor,
  shopQuestionAnchor,
  medicalAlertAnchor,
}: {
  /** The refused field's anchor, or none when nothing was refused. */
  refusedAnchor: string | undefined;
  /** A shop question's own anchor when the refusal is one, else none. */
  shopQuestionAnchor: string | undefined;
  medicalAlertAnchor: string;
}): Partial<Record<WaiverRailSegmentId, string>> {
  if (refusedAnchor === undefined) return {};
  if (refusedAnchor === "medical-questionnaire" || refusedAnchor === medicalAlertAnchor) {
    return { medical: refusedAnchor };
  }
  if (shopQuestionAnchor !== undefined) return { questions: shopQuestionAnchor };
  return { sign: refusedAnchor };
}

/** The segments in the order a diver walks them. Never re-ordered. */
export const WAIVER_RAIL_ORDER = ["release", "medical", "questions", "sign"] as const;

/** The rail's names: the three every release has, and Questions when the shop asks any. */
export type WaiverRailLabels = Record<Exclude<WaiverRailSegmentId, "questions">, string> & {
  questions?: string;
  /**
   * Each step's state in words, read after its name ("Release, done"), so a
   * step's state never rests on ink alone (dive-domain review, B56).
   */
  states?: { done: string; open: string };
};

export type WaiverRailProgress = {
  release: boolean;
  medical: boolean;
  /** Null when the release asks no shop questions, and the rail draws no such step. */
  questions: boolean | null;
  sign: boolean;
  /** How many steps have settled — always 0…total, always reachable. */
  done: number;
  /** 3, or 4 with the shop's questions. */
  total: number;
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
  /**
   * The shop's own questions, when the release asks any: how many required
   * ones are still blank, and whether the diver has reached the section
   * (scrolled to it, focused one of its controls, or answered one). Absent,
   * the rail has its three steps. The step settles once Medical has, the
   * section has been reached and nothing required is blank, never on which
   * answer was given: shop questions inform and never gate. Without
   * `reached`, a release whose questions are all optional ticked the step
   * while it was still below the fold (dive-domain review 2, S7).
   */
  shopQuestions?: { requiredRemaining: number; reached: boolean };
}): WaiverRailProgress {
  const release = input.signed || input.medicalAnswered > 0;
  const medical =
    !input.medicalStillOpen &&
    (input.signed ||
      (input.medicalTotal > 0 &&
        input.medicalAnswered >= input.medicalTotal &&
        (input.medicalFollowUpsRemaining ?? 0) === 0));
  const questions = input.shopQuestions
    ? input.signed ||
      (medical && input.shopQuestions.reached && input.shopQuestions.requiredRemaining === 0)
    : null;
  const sign = input.signed;
  const steps = questions === null ? [release, medical, sign] : [release, medical, questions, sign];
  return {
    release,
    medical,
    questions,
    sign,
    done: steps.filter(Boolean).length,
    total: steps.length,
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
  /** The segment names in the diver's own language, already resolved. */
  labels: WaiverRailLabels;
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
  // Questions is a step only on a release that asks the shop's own.
  const steps = WAIVER_RAIL_ORDER.filter((id) => progress[id] !== null && labels[id] !== undefined);
  // The step the diver is on: the first one still open, and none once the
  // waiver is signed (a held Medical on a signed record is open, not current).
  const current = progress.sign ? undefined : steps.find((id) => !progress[id]);
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
    //
    // 16px before the count, where the steps keep 20px between them: at 390
    // the row needs 368px of the 370px column, where 20px needed 372 and sent
    // the count to a line of its own. The count is spread to the row's end
    // rather than pushed there by a margin, so a count that does wrap (360, a
    // longer language) starts its line at the left edge (K-533).
    <div
      data-testid={WAIVER_RAIL_TEST_ID}
      className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-y border-border py-3 ${className}`.trim()}
    >
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {steps.map((id, index) => {
          const settled = progress[id] === true;
          const label = labels[id];
          const anchor = anchors?.[id];
          const isCurrent = id === current;
          const tone = isCurrent
            ? "font-semibold text-foreground"
            : settled
              ? "text-foreground"
              : "text-muted";
          // A flex box, not a block, so the label and its middot sit on one
          // line box (K-225).
          return (
            <li
              key={id}
              data-rail-step={id}
              aria-current={isCurrent ? "step" : undefined}
              className={`flex items-center gap-x-2 ${tone}`}
            >
              {index > 0 ? (
                <span aria-hidden="true" className="font-normal text-muted">
                  ·
                </span>
              ) : null}
              {settled ? (
                // A drawn check on a settled step, never a ring on an open one:
                // the step's state by shape as well as ink (B56 review).
                <svg
                  aria-hidden="true"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="size-3.5 shrink-0"
                  data-rail-done=""
                >
                  <path d="M3 8.5l3 3 7-7" />
                </svg>
              ) : null}
              {anchor ? (
                <a
                  href={`#${anchor}`}
                  className="inline-flex min-h-11 items-center text-primary underline underline-offset-4 hover:no-underline"
                >
                  {label}
                </a>
              ) : (
                <span>{label}</span>
              )}
              {labels.states ? (
                <span className="sr-only">
                  {`, ${settled ? labels.states.done : labels.states.open}`}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      <span className="text-sm text-muted tabular-nums">{doneLabel}</span>
    </div>
  );
}
