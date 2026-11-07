"use client";

import Link from "next/link";
import { useRef } from "react";
import { buttonClass } from "@/components/ui/button";
import { SummaryCaret } from "@/components/ui/disclosure";
import { controlClass, DateField } from "@/components/ui/form";
import { QueryForm } from "@/components/ui/QueryForm";

/**
 * **The activity log's toolbar**: who, what, and a date range, the way the
 * Orders ledger filters (`OrdersToolbar`). Each control applies when it
 * changes; `QueryForm` keeps it a real GET form that works before hydration
 * and turns the hydrated submit into a router navigation.
 *
 * The selects' labels are `sr-only` for Orders' reason: each states its own
 * value ("Everyone", "Everything"), and a caption above it would restate it.
 * The date boxes do not: two empty boxes look identical, so each carries a
 * visible "From" / "To" on its own row, beside the box rather than above it
 * so the toolbar stays one line of controls (issue #2314).
 *
 * The two date boxes are one unit (issue #2538): they wrap together, so "To"
 * never lands under "From" on a wide screen, and on a phone they stack on a
 * two-column grid whose first column is the wider caption, so both boxes
 * start at the same left edge.
 */
export type ActivityToolbarCopy = {
  personLabel: string;
  personAll: string;
  kindLabel: string;
  kindAll: string;
  fromLabel: string;
  toLabel: string;
  clear: string;
  /** "84 entries" — the whole filtered set. */
  count: string;
  filter: string;
  activeRange: string;
};

const FIELD_CLASS = "min-w-36 flex-1 sm:w-44 sm:flex-none";
/** The From and To pair: a caption column and a box column, one row from `sm` up. */
const DATE_RANGE_CLASS =
  "grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-3 sm:flex sm:w-auto";
const DATE_BOX_CLASS = "min-w-0 sm:w-44";

export function ActivityToolbar({
  personId,
  kind,
  from,
  to,
  people,
  kinds,
  clearHref,
  copy,
}: {
  personId: string;
  kind: string;
  from: string;
  to: string;
  people: ReadonlyArray<{ value: string; label: string }>;
  kinds: ReadonlyArray<{ value: string; label: string }>;
  /** The way back to the whole log, or nothing when no filter is set. */
  clearHref?: string;
  copy: ActivityToolbarCopy;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const submit = () => formRef.current?.requestSubmit();

  return (
    <QueryForm ref={formRef} className="flex flex-wrap items-center gap-3">
      <div className={FIELD_CLASS}>
        <label className="sr-only" htmlFor="activity-person">
          {copy.personLabel}
        </label>
        <select
          id="activity-person"
          name="personId"
          defaultValue={personId}
          onChange={submit}
          className={controlClass}
        >
          <option value="">{copy.personAll}</option>
          {people.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className={FIELD_CLASS}>
        <label className="sr-only" htmlFor="activity-kind">
          {copy.kindLabel}
        </label>
        <select
          id="activity-kind"
          name="kind"
          defaultValue={kind}
          onChange={submit}
          className={controlClass}
        >
          <option value="">{copy.kindAll}</option>
          {kinds.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <details open={Boolean(from || to)} className="group/filter w-full sm:w-auto">
        <summary className={buttonClass({ variant: "secondary", size: "sm" })}>
          {copy.filter}
          <SummaryCaret className="ms-2 size-3 group-open/filter:rotate-90" />
        </summary>
        <div className={`${DATE_RANGE_CLASS} mt-3`}>
          <label className="text-sm text-muted" htmlFor="activity-from">
            {copy.fromLabel}
          </label>
          <DateField
            id="activity-from"
            name="from"
            defaultValue={from}
            onChange={submit}
            wrapperClassName={DATE_BOX_CLASS}
          />
          <label className="text-sm text-muted sm:ms-1" htmlFor="activity-to">
            {copy.toLabel}
          </label>
          <DateField
            id="activity-to"
            name="to"
            defaultValue={to}
            onChange={submit}
            wrapperClassName={DATE_BOX_CLASS}
          />
        </div>
      </details>
      {copy.activeRange ? <p className="text-sm text-muted">{copy.activeRange}</p> : null}
      {clearHref ? (
        <Link
          href={clearHref}
          scroll={false}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {copy.clear}
        </Link>
      ) : null}

      <p className="ms-auto text-sm text-muted tabular-nums">{copy.count}</p>
    </QueryForm>
  );
}
