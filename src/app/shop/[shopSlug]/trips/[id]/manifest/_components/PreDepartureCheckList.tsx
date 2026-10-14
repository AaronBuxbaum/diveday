"use client";

import { useActionState, useEffect, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { cardSummaryClass, sectionCardClass } from "@/components/ui/card";
import { SummaryCaret } from "@/components/ui/disclosure";
import { StatusMark } from "@/components/ui/StatusMark";
import { scopedId } from "@/lib/element-id";
import { CLEAR_CONFIRM_MIN_GAP_MS, CLEAR_CONFIRM_TIMEOUT_MS } from "@/lib/pre-departure-check";
import type { PreDepartureCheckResult } from "../actions";

export type PreDepartureCheckAction = (
  prev: PreDepartureCheckResult,
  formData: FormData,
) => Promise<PreDepartureCheckResult>;

export type PreDepartureCheckListCopy = {
  heading: string;
  /** "Before you leave the dock — 3 of 5 checked", already filled server-side. */
  summary: string;
  errorRefusal: string;
  checkedLabel: string;
  uncheckedLabel: string;
  /** "Tap again to clear", shown once the first tap on a checked item has asked. */
  confirmClear: string;
};

export type PreDepartureCheckListItem = {
  id: string;
  label: string;
  /** Already resolved server-side ("Checked by the recorder · 7:12 AM") — see `formatDateTimeTz`. */
  checkedByLine?: string;
  /**
   * The whole printed line, composed server-side — "Emergency oxygen kit
   * aboard — Checked by the recorder · 7:12 AM" or "…— Not checked" — never
   * assembled from parts client-side, the same rule every other sentence in
   * this app follows (word order and the separator itself are locale
   * choices, not a JSX literal's to make).
   */
  printLine: string;
};

function PreDepartureCheckRow({
  action,
  item,
  copy,
}: {
  action: PreDepartureCheckAction;
  item: PreDepartureCheckListItem;
  copy: PreDepartureCheckListCopy;
}) {
  const [result, formAction, isPending] = useActionState(action, null);
  const checked = item.checkedByLine !== undefined;
  // **Checking is one tap; clearing is two** (#2481). A brushed button or a
  // wet hand on a moving deck must not clear "Emergency oxygen kit aboard"
  // unnoticed, so the first tap on a checked item only asks. A blur, Escape,
  // or a few seconds untouched stand it down, so an ask left behind never
  // turns a later stray tap into a clear.
  // A bounced double tap (two taps ~50ms apart) is one tap, so the ask only
  // arms — and only says "Tap again to clear" — once the gap has passed.
  const [asking, setAsking] = useState(false);
  const [settled, setSettled] = useState(false);
  const standDown = () => {
    setAsking(false);
    setSettled(false);
  };
  const askingNow = asking && checked;
  const armed = askingNow && settled;
  useEffect(() => {
    if (!askingNow) return;
    const settle = setTimeout(() => setSettled(true), CLEAR_CONFIRM_MIN_GAP_MS);
    const expire = setTimeout(() => {
      setAsking(false);
      setSettled(false);
    }, CLEAR_CONFIRM_TIMEOUT_MS);
    return () => {
      clearTimeout(settle);
      clearTimeout(expire);
    };
  }, [askingNow]);
  // Whatever the server said, the ask is spent once the submit settles: a
  // refused clear must not leave the item one tap from clearing.
  useEffect(() => {
    if (!isPending) {
      setAsking(false);
      setSettled(false);
    }
  }, [isPending]);
  return (
    <li>
      <form action={formAction}>
        <input type="hidden" name="checklistItemId" value={item.id} />
        <input type="hidden" name="status" value={checked ? "cleared" : "checked"} />
        <button
          // Only the second tap on a checked item is a submit.
          type={checked && !armed ? "button" : "submit"}
          disabled={isPending}
          aria-busy={isPending}
          aria-pressed={checked}
          onClick={(event) => {
            if (checked && !armed) {
              event.preventDefault();
              // A tap inside the gap is the first one bouncing: ignored.
              if (!askingNow) setAsking(true);
            }
          }}
          onBlur={standDown}
          onKeyDown={(event) => {
            if (event.key === "Escape") standDown();
          }}
          className={buttonClass({
            variant: checked ? "primary" : "secondary",
            size: "md",
            className: "w-full justify-start gap-2 text-start",
          })}
        >
          <StatusMark variant={checked ? "checked" : "unchecked"} size="md" />
          <span className="flex flex-col">
            <span>{item.label}</span>
            {armed ? (
              <span className="text-sm font-semibold">{copy.confirmClear}</span>
            ) : item.checkedByLine ? (
              <span className="text-sm font-normal">{item.checkedByLine}</span>
            ) : null}
            {armed ? null : (
              <span className="sr-only">{checked ? copy.checkedLabel : copy.uncheckedLabel}</span>
            )}
          </span>
        </button>
        {/* A changed button name is not announced; this is. */}
        <span role="status" className="sr-only">
          {armed ? copy.confirmClear : ""}
        </span>
      </form>
      {result && !result.ok ? (
        <p role="alert" className="mt-1 text-sm font-medium text-danger">
          {copy.errorRefusal}
        </p>
      ) : null}
    </li>
  );
}

/**
 * The pre-departure safety checklist's live control (ADR
 * 20260824-pre-departure-safety-check) — opt-in by presence, the same rule
 * the gear register follows: a shop with no items renders nothing, not an
 * empty card.
 *
 * **One line at rest** (ADR 20260827-the-departure-is-two-working-surfaces,
 * decision 2: the boat-check items are a "one tap away" concern, not an
 * "always on screen" one). The check happens once, before the boat leaves;
 * five permanent full-width buttons above the head count spent the top of
 * every screen, at every checkpoint, on work that was finished at 6:50 — and
 * on a 390px phone that was most of a screenful before the first diver's name.
 * The state it carries is not hidden by collapsing it: the summary line states
 * how many of how many are checked, which is the fact a captain glances for.
 *
 * **Open until it is done, at the dock** (UX audit 2026-10-07, item 17). The
 * one line at rest was right for a finished check and wrong for an unfinished
 * one: "0 of 5 checked" sat collapsed above the roll call of a boat about to
 * leave, the one list that should not be a tap away then. So the caller opens
 * it while an item is unchecked at the departure checkpoint, and it folds to
 * its line the moment the last item is checked. After a dive it stays a line
 * either way: the boat has left, and the count on the line is the record.
 *
 * **Paper is unaffected.** A closed `<details>` contributes nothing to print,
 * so the printed lines are rendered outside it — the sheet the boat carries
 * still lists every item and who checked it, unconditionally.
 */
export function PreDepartureCheckList({
  idPrefix,
  action,
  items,
  copy,
  atDeparture,
}: {
  /** Scopes this section's element ids to one departure — see `scopedId`. */
  idPrefix?: string;
  action: PreDepartureCheckAction;
  items: readonly PreDepartureCheckListItem[];
  copy: PreDepartureCheckListCopy;
  /** The departure checkpoint is open: an unfinished list stands open. */
  atDeparture: boolean;
}) {
  if (items.length === 0) return null;
  // Controlled by the facts, not remembered: React writes `open` only when
  // this value changes, so a crew member who folds an unfinished list keeps
  // it folded across a tap, and the last check folds it for everyone. A
  // reload or a switch back to the departure checkpoint opens an unfinished
  // list again, and that is intended: the fold is not saved anywhere, and an
  // unfinished boat check before the boat leaves is the state worth reopening.
  const open = atDeparture && items.some((item) => item.checkedByLine === undefined);
  return (
    <section
      aria-labelledby={scopedId(idPrefix, "pre-departure-check-heading")}
      className={sectionCardClass({ padding: "none" })}
    >
      <details open={open} className="group/check print:hidden">
        <summary className={cardSummaryClass({ className: "group/summary min-h-14 px-4 py-4" })}>
          <SummaryCaret className="group-open/check:rotate-90" />
          <h2
            id={scopedId(idPrefix, "pre-departure-check-heading")}
            className="text-base font-semibold text-balance group-hover/summary:underline"
          >
            {copy.summary}
          </h2>
        </summary>
        <ul className="flex flex-col gap-2 px-4 pb-4">
          {items.map((item) => (
            <PreDepartureCheckRow key={item.id} action={action} item={item} copy={copy} />
          ))}
        </ul>
      </details>
      {/* The trip packet's print stylesheet hides every button/input in
          `.trip-print-bundle` on the strength that nothing value-bearing lives
          inside one — and a collapsed disclosure prints nothing at all. Both
          are why the printed list is restated here, outside the control, so the
          sheet a captain carries offline still says what was checked. */}
      <div className="hidden px-4 py-3 print:block">
        <h2 className="text-base font-semibold">{copy.heading}</h2>
        <ul className="mt-1 flex flex-col gap-1">
          {items.map((item) => (
            <li key={item.id} className="text-sm">
              {/* `inline`: a bare mark is a block (preflight), and printed the
                  box above its line rather than in front of it (K-15). */}
              <StatusMark
                variant={item.checkedByLine !== undefined ? "checked" : "unchecked"}
                size="sm"
                inline
              />{" "}
              {item.printLine}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
