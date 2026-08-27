"use client";

import { useActionState } from "react";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
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
};

export type PreDepartureCheckListItem = {
  id: string;
  label: string;
  /** Already resolved server-side ("Checked by Marcus Webb · 7:12 AM") — see `formatDateTimeTz`. */
  checkedByLine?: string;
  /**
   * The whole printed line, composed server-side — "Emergency oxygen kit
   * aboard — Checked by Marcus Webb · 7:12 AM" or "…— Not checked" — never
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
  return (
    <li>
      <form action={formAction}>
        <input type="hidden" name="checklistItemId" value={item.id} />
        <input type="hidden" name="status" value={checked ? "cleared" : "checked"} />
        <button
          type="submit"
          disabled={isPending}
          aria-busy={isPending}
          className={buttonClass({
            variant: checked ? "primary" : "secondary",
            size: "sm",
            className: "w-full justify-start gap-2 text-start",
          })}
        >
          <span aria-hidden="true">{checked ? "☑️" : "☐"}</span>
          <span className="flex flex-col">
            <span>{item.label}</span>
            {item.checkedByLine ? (
              <span className="text-xs font-normal opacity-80">{item.checkedByLine}</span>
            ) : null}
          </span>
        </button>
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
 * **Paper is unaffected.** A closed `<details>` contributes nothing to print,
 * so the printed lines are rendered outside it — the sheet the boat carries
 * still lists every item and who checked it, unconditionally.
 */
export function PreDepartureCheckList({
  action,
  items,
  copy,
}: {
  action: PreDepartureCheckAction;
  items: readonly PreDepartureCheckListItem[];
  copy: PreDepartureCheckListCopy;
}) {
  if (items.length === 0) return null;
  return (
    <section
      aria-labelledby="pre-departure-check-heading"
      className={sectionCardClass({ padding: "none", className: "mt-5" })}
    >
      <details className="group/check print:hidden">
        <summary className="group/summary flex min-h-14 cursor-pointer list-none items-center gap-2 px-4 py-3 select-none [&::-webkit-details-marker]:hidden">
          <DisclosureCaret className="group-open/check:rotate-90" />
          <h2
            id="pre-departure-check-heading"
            className="text-base font-semibold group-hover/summary:underline"
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
              <span aria-hidden="true">{item.checkedByLine !== undefined ? "☑" : "☐"}</span>{" "}
              {item.printLine}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
