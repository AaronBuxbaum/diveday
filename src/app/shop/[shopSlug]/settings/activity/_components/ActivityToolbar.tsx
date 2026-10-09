"use client";

import Link from "next/link";
import { useRef } from "react";
import { buttonClass } from "@/components/ui/button";
import { controlClass, DateField } from "@/components/ui/form";
import { QueryForm } from "@/components/ui/QueryForm";

/**
 * **The activity log's toolbar**: who, what, and a date range, the way the
 * Orders ledger filters (`OrdersToolbar`). Each control applies when it
 * changes; `QueryForm` keeps it a real GET form that works before hydration
 * and turns the hydrated submit into a router navigation.
 *
 * The labels are `sr-only` for Orders' reason: each select states its own
 * value ("Everyone", "Everything"), and a caption above it would restate it.
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
};

const FIELD_CLASS = "min-w-36 flex-1 sm:w-44 sm:flex-none";

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

      <div className={FIELD_CLASS}>
        <label className="sr-only" htmlFor="activity-from">
          {copy.fromLabel}
        </label>
        <DateField id="activity-from" name="from" defaultValue={from} onChange={submit} />
      </div>
      <div className={FIELD_CLASS}>
        <label className="sr-only" htmlFor="activity-to">
          {copy.toLabel}
        </label>
        <DateField id="activity-to" name="to" defaultValue={to} onChange={submit} />
      </div>

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
