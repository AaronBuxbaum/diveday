import type { ReactNode } from "react";
import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { SettledCheck } from "@/components/ui/SettledCheck";
import type { ThreadStepId, ThreadStepState } from "@/lib/thread-steps";

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
 * **The page's one status statement.** A figure and what is next, and nothing
 * else on the page may say either.
 *
 * The count leads as a *figure* rather than as another line of `text-sm`
 * (Clearwater decision 3), and there is no bar: the spine's steps are all
 * finishable, so the number can always reach its total, but a bar would only
 * re-draw what the two words beside it already say.
 */
export function ThreadStatus({
  done,
  doneSuffix,
  trailing,
  settled = false,
}: {
  done: number;
  /**
   * "of 4 done" — the total lives in these words rather than in a second
   * number of its own, so the figure and its denominator read as one sentence
   * to a screen reader. No `role="progressbar"`: this is a statement, not a
   * widget, and the bar it replaced is gone.
   */
  doneSuffix: string;
  /** "Next: Gear and sizes", the nothing-on-your-side line, or the all-set words. */
  trailing: string;
  /** Everything is done: `trailing` renders as a settled success line, never coral. */
  settled?: boolean;
}) {
  return (
    <p
      data-testid={THREAD_STATUS_TEST_ID}
      className="mt-8 flex flex-wrap items-baseline gap-x-3 gap-y-1"
    >
      <span className="text-3xl font-semibold tracking-tight tabular-nums">{done}</span>
      <span className="text-base font-medium text-muted">{doneSuffix}</span>
      {settled ? (
        // Plain success ink, deliberately not an `EarnedMoment`: the thread
        // spends coral exactly three times (booked, the waiver's completed
        // state, welcome home), and "you have finished your paperwork" is the
        // waiver page's moment already. One moment does not fire twice.
        <SettledCheck
          settled
          label={trailing}
          className="ms-auto text-sm font-semibold text-success-strong"
        />
      ) : (
        <span className="ms-auto text-sm text-muted">{trailing}</span>
      )}
    </p>
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
 * The spine itself: hairline rows straight on the page background.
 *
 * **At most one step is open at rest**, and it stays that way after a tap —
 * the openable steps share one native `<details name>` accordion group, so the
 * browser closes the others with no listener, no state and no JS to fail.
 * `AutoOpenDetails` rides on top of it for deep links, which a client-side
 * route change would otherwise leave collapsed.
 */
export function ThreadSpine({
  steps,
  className = "",
}: {
  steps: ThreadSpineStep[];
  className?: string;
}) {
  return (
    <ol className={`mt-6 ${className}`.trim()}>
      {steps.map((step) => (
        // `data-thread-step` is the spine's own hook: an e2e spec scopes to a
        // step by id through `page.locator`, which is the reach a `data-`
        // attribute exists for (e2e/fixtures.ts filters every `getBy*` to
        // visible nodes, so a closed step's contents are unreachable by role).
        <li
          key={step.id}
          data-thread-step={step.id}
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
              <summary className="flex min-h-14 cursor-pointer list-none flex-col justify-center gap-1 py-3 select-none [&::-webkit-details-marker]:hidden">
                <StepHead step={step} />
              </summary>
              <div className="pb-6">{step.body}</div>
            </AutoOpenDetails>
          ) : (
            <div className="flex min-h-14 flex-col justify-center gap-1 py-3">
              <StepHead step={step} />
            </div>
          )}
        </li>
      ))}
    </ol>
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
      {step.line ? <span className="ps-8 text-sm text-muted">{step.line}</span> : null}
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
