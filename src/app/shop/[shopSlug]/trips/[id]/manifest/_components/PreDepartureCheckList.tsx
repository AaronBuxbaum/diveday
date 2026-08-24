"use client";

import { useActionState } from "react";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import type { PreDepartureCheckResult } from "../actions";

export type PreDepartureCheckAction = (
  prev: PreDepartureCheckResult,
  formData: FormData,
) => Promise<PreDepartureCheckResult>;

export type PreDepartureCheckListCopy = {
  heading: string;
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
      <form action={formAction} className="print:hidden">
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
      {/* The trip packet's print stylesheet hides every button/input in
          `.trip-print-bundle` on the strength that nothing value-bearing
          lives inside one — this is the fact restated outside a control, the
          same shape DiverRollCall's print pill takes, so the printed sheet a
          captain carries offline still says what was checked. */}
      <p className="hidden text-sm print:block">
        <span aria-hidden="true">{checked ? "☑" : "☐"}</span> {item.printLine}
      </p>
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
      className={sectionCardClass({ className: "mt-6" })}
    >
      <h2 id="pre-departure-check-heading" className="text-base font-semibold text-ink">
        {copy.heading}
      </h2>
      <ul className="mt-3 flex flex-col gap-2">
        {items.map((item) => (
          <PreDepartureCheckRow key={item.id} action={action} item={item} copy={copy} />
        ))}
      </ul>
    </section>
  );
}
