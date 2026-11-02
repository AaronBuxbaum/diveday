import type { ReactNode } from "react";
import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { SettledCheck } from "@/components/ui/SettledCheck";
import { SETTLED_CHECK_TEXT_INSET } from "@/components/ui/settled-mark";
import { ITEM_TITLE_CLASS } from "@/components/ui/typography";
import type { DiverTranslator } from "@/i18n/messages";
import { THREAD_STEP_STATE_KEYS, THREAD_STEP_TITLE_KEYS } from "@/i18n/thread-labels";
import type {
  ThreadSpine as ThreadSpineModel,
  ThreadStep,
  ThreadStepId,
  ThreadStepState,
} from "@/lib/thread-steps";

/**
 * **The thread page's step spine** — ADR 20260827-the-divers-thread, decision
 * 3 (slice 7c), speaking ADR 20260827-clearwater-surface-language's open
 * ledger (decision 2).
 *
 * What it replaced was a card of nine rows, five of which were inline forms
 * open at once, under a progress bar whose own copy admitted it could never
 * fill, on a page that stated the booking's status four times in one screenful
 * — an earned moment, an emails line, a receipt panel, and the checklist's own
 * "almost there" sentence. Here the status is said **once**, by
 * {@link ThreadStatus}, and the spine underneath is the order the diver walks:
 * a settled step is one line, the current step is open with its form inline,
 * and every other openable step is a closed line one tap away.
 *
 * Presentational only: the page composes each step's words and body (the forms
 * bind token-scoped server actions and cannot move here) and hands them over.
 * That split is what lets `ThreadSpine.test.tsx` pin the rules — one status
 * statement, one open step at rest — without a database.
 */

/** The one status statement's hook, named here so the test cannot drift from the page. */
export const THREAD_STATUS_TEST_ID = "thread-status";

/**
 * **The page's one status statement.** What is next, then how far along, and
 * nothing else on the page may say either.
 *
 * **The next step leads, as a heading** (UX review 2026-10-10, item 9). The
 * count used to lead as a large figure, so a diver who had just paid opened
 * the thread on a big "0" beside "of 4 done · Next: Sign": the first number
 * after paying read as a failing grade, and the one thing they could do was the
 * smallest text in the row. Now "Next: sign your waiver"
 * is the line they read, and "0 of 4 done" is the quiet line under it. There
 * is still no bar: the steps are all finishable, and a bar would only re-draw
 * what the small line already says.
 */
export function ThreadStatus({
  lead,
  progress,
  settled = false,
}: {
  /** "Next: sign your waiver", the nothing-on-your-side line, or the all-set words. */
  lead: string;
  /**
   * "0 of 4 done", one phrase so a screen reader hears the figure and its
   * denominator as one sentence. No `role="progressbar"`: this is a
   * statement, not a widget.
   */
  progress: string;
  /** Everything is done: `lead` renders as a settled success line, never coral. */
  settled?: boolean;
}) {
  return (
    <div data-testid={THREAD_STATUS_TEST_ID} className="mt-8">
      {settled ? (
        // Plain success ink, deliberately not an `EarnedMoment`: the thread
        // spends coral exactly three times (booked, the waiver's completed
        // state, welcome home), and "you have finished your paperwork" is the
        // waiver page's moment already. One moment does not fire twice.
        <p>
          <SettledCheck
            settled
            label={lead}
            className={`${ITEM_TITLE_CLASS} text-success-strong`}
          />
        </p>
      ) : (
        <p className={`${ITEM_TITLE_CLASS} text-pretty`}>{lead}</p>
      )}
      <p className="mt-1 text-sm text-muted tabular-nums">{progress}</p>
    </div>
  );
}

export type ThreadSpineStep = {
  id: ThreadStepId;
  state: ThreadStepState;
  /**
   * This is the step open at rest — the first one that is the diver's. Only
   * its state word wears the accent ink: every non-settled step is honestly
   * "Your turn", and four of them shouting it in primary down one column is a
   * page with four leads and no order. The word stays on every one of them
   * (colour never carries a state alone); what the ink says is *start here*.
   */
  current: boolean;
  /** The step's name in the diver's own language, already resolved. */
  title: string;
  /** The state in words, for anything not settled — colour never carries a state alone. */
  stateWord: string | null;
  /**
   * The one fact this step states: a settled line ("Signed and on file"), or
   * what the shop is still doing. Rendered under the title on a line of its
   * own, and inside the body on a step that opens.
   */
  line: string | null;
  /** The step's form. A step with no body is a line and never opens. */
  body?: ReactNode;
};

/**
 * One step's row between its hairlines, open or closed, settled or not: the
 * `<summary>` of a step that opens is this row too, so a closed step centres
 * its name exactly where a settled line does.
 */
const STEP_ROW_CLASS = "flex min-h-14 flex-col justify-center gap-1 py-3";

/**
 * An *open* step's head lends its body the 8px that clear the focus ring
 * (K-161): 4px of bottom where the closed row has 12, so the fact stands 12px
 * over the form as it did before the ring fix rather than 20. The floor gives
 * up the same 8px, so a head with no fact under it keeps its name 16px down
 * whether the step is open or closed, instead of dropping 4px as it opens.
 * Only while open: closed, the head is the row between two hairlines, and its
 * even `py-3` is what centres it there.
 */
const OPEN_STEP_HEAD_CLASS = "group-open/step:min-h-12 group-open/step:pb-1";

/**
 * The spine itself: hairline rows straight on the page background.
 *
 * **At most one step is open at rest**, and it stays that way after a tap —
 * the openable steps share one native `<details name>` accordion group, so the
 * browser closes the others with no listener, no state and no JS to fail.
 * `AutoOpenDetails` rides on top of it for deep links, which a client-side
 * route change would otherwise leave collapsed.
 */
/**
 * The engine's spine as the figure draws it: each step's title and state word
 * in the diver's language, the one open at rest marked current, and the line
 * and body the page composed for it.
 */
export function threadSpineSteps(
  spine: Pick<ThreadSpineModel, "steps" | "current">,
  t: DiverTranslator,
  stepLine: (step: ThreadStep) => string | null,
  stepBody: (step: ThreadStep) => ReactNode,
): ThreadSpineStep[] {
  return spine.steps.map((step) => ({
    id: step.id,
    state: step.state,
    current: step.id === spine.current,
    title: t(THREAD_STEP_TITLE_KEYS[step.id]),
    // "Your turn" names the one step that is next and no other (visual
    // review 2026-10-24, B24): on four open steps it said nothing about which
    // to do. A step waiting on the shop still says so; a done step speaks
    // through its own settled line.
    stateWord:
      step.state === "done" || (step.state === "your_turn" && step.id !== spine.current)
        ? null
        : t(THREAD_STEP_STATE_KEYS[step.state]),
    line: stepLine(step),
    body: stepBody(step) ?? undefined,
  }));
}

export function ThreadSpine({
  steps,
  heading,
  className = "",
}: {
  steps: ThreadSpineStep[];
  /**
   * The checklist's name, for a screen reader only: the step bodies hold H3s
   * ("Want a morning pickup?", "I could use a hand") that otherwise sat under
   * the page's H1 with nothing between (fourth review, item 47). The status
   * line above already says it to a sighted reader.
   */
  heading?: string;
  className?: string;
}) {
  return (
    <>
      {heading ? <h2 className="sr-only">{heading}</h2> : null}
      <ol className={`mt-6 ${className}`.trim()}>
        {steps.map((step) => (
          // `data-thread-step` is the spine's own hook: an e2e spec scopes to a
          // step by id through `page.locator`, which is the reach a `data-`
          // attribute exists for (e2e/fixtures.ts filters every `getBy*` to
          // visible nodes, so a closed step's contents are unreachable by role).
          // `data-step-state` says where the step stands without reading the
          // state word, which a settled step does not print.
          <li
            key={step.id}
            data-thread-step={step.id}
            data-step-state={step.state}
            className="border-t border-border last:border-b"
          >
            {step.body ? (
              <AutoOpenDetails
                id={`step-${step.id}`}
                openOnHash={`step-${step.id}`}
                name="thread-step"
                open={step.current}
                className="group/step"
              >
                {/* Every part of the head is phrasing content, `<span>`s and
                  not `<p>`s: `<summary>`'s content model takes phrasing (or a
                  single heading), and a paragraph in here is invalid markup
                  that browsers silently re-parent. */}
                <summary
                  className={`${STEP_ROW_CLASS} ${OPEN_STEP_HEAD_CLASS} cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden`}
                >
                  <StepHead step={step} />
                </summary>
                {/* `pt-2`: the summary's focus ring reaches 5px below it, and
                  the body is a later sibling that paints over whatever it
                  overlaps — flush, "Sign your waiver" hid the ring's bottom
                  arm (K-161). The open head lends these 8px from its own
                  bottom (`OPEN_STEP_HEAD_CLASS`), so the fact still stands
                  12px over the form. */}
                <div className="pt-2 pb-6">{step.body}</div>
              </AutoOpenDetails>
            ) : (
              <div className={STEP_ROW_CLASS}>
                <StepHead step={step} />
              </div>
            )}
          </li>
        ))}
      </ol>
    </>
  );
}

/**
 * A step's head: the mark, its name, the state in words, and the one fact the
 * step states — the whole of a settled step, and the summary of an open one.
 *
 * The fact lives **here** rather than inside the body on purpose. A settled
 * step still opens where its form is worth re-opening (a diver changes their
 * fin size the night before), so putting "Your sizes are with the crew" in the
 * body would hide the very thing the collapsed line exists to say.
 */
function StepHead({ step }: { step: ThreadSpineStep }) {
  return (
    <>
      <span className="flex w-full items-center gap-3">
        <StepMark step={step} />
        {step.stateWord ? (
          <span
            className={`shrink-0 text-sm font-semibold ${
              step.current ? "text-primary" : "text-muted"
            }`}
          >
            {step.stateWord}
          </span>
        ) : null}
      </span>
      {/* Hung on the name's own edge: the mark's width plus its gap. */}
      {step.line ? (
        <span className={`${SETTLED_CHECK_TEXT_INSET} text-sm text-muted`}>{step.line}</span>
      ) : null}
    </>
  );
}

/**
 * The step's mark and its name, as one object.
 *
 * `SettledCheck` is Clearwater 6a's settle mark and the only one this page
 * draws: filled and green once the step is done, an open ring while it is not.
 * Its label is a required prop rather than an option, which is the
 * accessibility commitment ("every colour-carried state also carries a word")
 * enforced by the component's own type rather than by a reviewer.
 */
function StepMark({ step }: { step: ThreadSpineStep }) {
  return (
    <SettledCheck
      settled={step.state === "done"}
      label={step.title}
      className={`min-w-0 flex-1 text-base ${step.state === "done" ? "font-medium" : "font-semibold"}`}
    />
  );
}
