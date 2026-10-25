"use client";

import { useActionState, useEffect, useState } from "react";
import { cardSummaryClass, sectionCardClass } from "@/components/ui/card";
import { SummaryCaret } from "@/components/ui/disclosure";
import { StatusMark } from "@/components/ui/StatusMark";
import { scopedId } from "@/lib/element-id";
import { CLEAR_CONFIRM_MIN_GAP_MS, CLEAR_CONFIRM_TIMEOUT_MS } from "@/lib/pre-departure-check";
import type { PreDepartureCheckResult } from "../actions";
import {
  type SnagAction,
  SnagAnswer,
  type SnagCopy,
  SnagNoteForm,
  type SnagViewItem,
} from "./BoatSnagControls";

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
} & Omit<SnagCopy, "errorRefusal">;

/** The two snag acts, bound to this departure; absent where nothing may be written. */
export type SnagActions = { note: SnagAction; answer: SnagAction };

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
  /** Snags this departure's crew wrote against this line, still open. */
  snags?: readonly SnagViewItem[];
};

function PreDepartureCheckRow({
  action,
  item,
  copy,
  snagActions,
}: {
  action: PreDepartureCheckAction;
  item: PreDepartureCheckListItem;
  copy: PreDepartureCheckListCopy;
  /** Present when the departure has a boat: a note has a next crew to reach. */
  snagActions?: SnagActions;
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
            // A held Enter repeats keydown, and each repeat clicks: one press
            // could ask and then clear (#2567). Only the first press counts.
            if (event.repeat) {
              event.preventDefault();
              return;
            }
            if (event.key === "Escape") standDown();
          }}
          // A flat row, not a card per line (visual review 2026-10-24, B07):
          // the mark says checked, and the list's dividers draw the rows.
          className="flex min-h-14 w-full touch-manipulation items-start gap-3 px-4 py-3 text-start text-base font-semibold hover:bg-surface-sunken disabled:opacity-60"
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
        <p role="alert" className="px-4 pb-2 text-sm font-medium text-danger">
          {copy.errorRefusal}
        </p>
      ) : null}
      {/* What this crew wrote against the line, until somebody fixes it. */}
      {(item.snags ?? []).map((snag) => (
        <div key={snag.id} className="mx-4 mb-3 border-s-2 border-warning ps-3 text-sm">
          <p className="font-medium">{snag.note}</p>
          <p className="text-muted">{snag.notedBy}</p>
          {snagActions ? (
            <SnagAnswer
              snagId={snag.id}
              action={snagActions.answer}
              copy={copy}
              offerStillThere={false}
            />
          ) : null}
        </div>
      ))}
    </li>
  );
}

/**
 * **What an earlier crew handed on** (fifth-loop ideas, item 1): the boat's
 * open snags written on another departure, above the checklist and outside
 * its fold, so the crew read them before the first tap. Each takes "Fixed"
 * or "Still there"; nothing here holds the boat at the dock.
 */
function CarriedSnags({
  idPrefix,
  carried,
  copy,
  snagActions,
}: {
  idPrefix?: string;
  carried: readonly SnagViewItem[];
  copy: PreDepartureCheckListCopy;
  snagActions?: SnagActions;
}) {
  return (
    <section
      aria-labelledby={scopedId(idPrefix, "boat-snags-heading")}
      className="border-b border-border bg-warning/10 px-4 py-4 print:hidden"
    >
      <h3 id={scopedId(idPrefix, "boat-snags-heading")} className="text-base font-semibold">
        {copy.snagsHeading}
      </h3>
      <ul className="mt-2 flex flex-col gap-3">
        {carried.map((snag) => (
          <li key={snag.id} className="text-sm">
            <p className="font-medium">{snag.line}</p>
            <p className="text-muted">{snag.notedBy}</p>
            {snag.stillThere ? <p className="text-muted">{snag.stillThere}</p> : null}
            {snagActions ? (
              <SnagAnswer
                snagId={snag.id}
                action={snagActions.answer}
                copy={copy}
                offerStillThere
              />
            ) : null}
          </li>
        ))}
      </ul>
    </section>
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
  carried = [],
  snagActions,
  paper = false,
}: {
  /** Scopes this section's element ids to one departure — see `scopedId`. */
  idPrefix?: string;
  action: PreDepartureCheckAction;
  items: readonly PreDepartureCheckListItem[];
  copy: PreDepartureCheckListCopy;
  /** The departure checkpoint is open: an unfinished list stands open. */
  atDeparture: boolean;
  /** Open snags an earlier departure of this boat handed on. */
  carried?: readonly SnagViewItem[];
  /** Present when the departure has a boat to hang a snag on. */
  snagActions?: SnagActions;
  /**
   * Composed as the trip packet's paper (`PAPER_PACKET`, B03): only the
   * printed list below, never the checks, the snag answers or the note form.
   */
  paper?: boolean;
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
      {carried.length > 0 && !paper ? (
        <CarriedSnags idPrefix={idPrefix} carried={carried} copy={copy} snagActions={snagActions} />
      ) : null}
      {paper ? null : (
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
          <ul className="divide-y divide-border border-t border-border">
            {items.map((item) => (
              <PreDepartureCheckRow
                key={item.id}
                action={action}
                item={item}
                copy={copy}
                snagActions={snagActions}
              />
            ))}
          </ul>
          {snagActions ? (
            <div className="border-t border-border">
              <SnagNoteForm items={items} action={snagActions.note} copy={copy} />
            </div>
          ) : null}
        </details>
      )}
      {/* The trip packet's print stylesheet hides every button/input in
          `.trip-print-bundle` on the strength that nothing value-bearing lives
          inside one — and a collapsed disclosure prints nothing at all. Both
          are why the printed list is restated here, outside the control, so the
          sheet a captain carries offline still says what was checked. */}
      <div data-print-only className="hidden px-4 py-3 print:block">
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
          {/* The boat's open snags ride on paper too: the sheet is what
              the crew holds when the tablet is dead. */}
          {[...carried, ...items.flatMap((item) => item.snags ?? [])].map((snag) => (
            <li key={snag.id} className="text-sm font-medium">
              {snag.printLine}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
