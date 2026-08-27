"use client";

import { useEffect, useRef, useState } from "react";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { QueryForm } from "@/components/ui/QueryForm";

export type ScheduleFiltersCopy = {
  tripType: string;
  allTrips: string;
  funDive: string;
  course: string;
  hasSpace: string;
  /** "What can you dive?" — the one question a diver can answer about themselves. */
  canDive: string;
  canDiveUnsaid: string;
  /** Each declarable level, in ladder order, already worded for this reader. */
  canDiveLevels: ReadonlyArray<{ value: string; label: string }>;
  hideAboveLevel: string;
};

/**
 * The schedule's filter row. Changing a filter *is* the ask, so any change
 * submits the form itself and no Apply button renders at all
 * (design/principles.md #10: the action rides on the control, not on a
 * second button the reader must map back to it).
 *
 * There is no Apply button for anyone. One used to render for every visitor
 * and be removed on hydration, so a real diver watched it flash in and out
 * beside "Has space"; it then moved into `<noscript>`, which traded the flash
 * for a fallback nobody could reach — a scripting-disabled browser never
 * relocates this page out of its hidden streaming div, so it sees the skeleton
 * and not the form (ADR 20260812-javascript-is-required). What remains is the
 * genuine cost, and it is small: a tap landing in the beat before hydration
 * does nothing yet.
 *
 * The form remains a plain GET: the URL carries the filters, and the list
 * below re-renders server-side, pixel-stable for visual regression.
 *
 * `QueryForm`, not a bare `<form method="get">`: auto-submit on change plus a
 * native GET submit meant one tap of "Has space" tore the document down and
 * put the diver back at the top of the page, above the filter they had just
 * touched. Same URL, same server render, client transition.
 */
export function ScheduleFilters({
  embed,
  month,
  tripTypeFilter,
  hasSpaceFilter,
  canDiveFilter,
  hideAboveFilter,
  aboveLevelNotice,
  copy,
}: {
  embed: boolean;
  month: string | null;
  tripTypeFilter: string | null;
  hasSpaceFilter: boolean;
  /**
   * The level the reader has stated, or null for unsaid. A **stated
   * preference**, never a gate: it dims and counts, and nothing downstream of it
   * touches admission or readiness (issue #696).
   */
  canDiveFilter: string | null;
  hideAboveFilter: boolean;
  /**
   * How many departures ask for more than the stated level, already worded with
   * its count — or null when there is nothing to say. Said **once**, here, beside
   * the control that caused it, rather than repeated on every card
   * (design/principles.md #9); each dimmed card wears a two-word chip instead.
   *
   * It lives inside the form rather than between the form and the list because
   * the list is addressed as `form + ul` across this suite, and an element
   * sibling in between silently breaks every one of those locators.
   */
  aboveLevelNotice: string | null;
  copy: ScheduleFiltersCopy;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  const submit = () => formRef.current?.requestSubmit();

  return (
    <QueryForm ref={formRef} className="mb-6 flex flex-wrap items-end gap-3">
      {embed ? <input type="hidden" name="embed" value="1" /> : null}
      {month ? <input type="hidden" name="month" value={month} /> : null}
      <FieldGrid columns={1} className="min-w-40">
        <Field label={copy.tripType}>
          <select
            name="tripType"
            defaultValue={tripTypeFilter ?? ""}
            onChange={submit}
            // The e2e suite waits on this before relying on change-to-submit —
            // the deterministic signal that the auto-apply handlers are live.
            data-hydrated={hydrated ? "true" : undefined}
            className={controlClass}
          >
            <option value="">{copy.allTrips}</option>
            <option value="fun_dive">{copy.funDive}</option>
            <option value="course">{copy.course}</option>
          </select>
        </Field>
      </FieldGrid>
      {/* The one thing a diver arriving here knows about themselves, and until
          now the one thing the filters never asked. Unsaid by default: this is
          an anonymous page, the answer is a fact about a person, and it is
          carried in the URL and nowhere else. */}
      <FieldGrid columns={1} className="min-w-44">
        <Field label={copy.canDive}>
          <select
            name="canDive"
            defaultValue={canDiveFilter ?? ""}
            onChange={submit}
            className={controlClass}
          >
            <option value="">{copy.canDiveUnsaid}</option>
            {copy.canDiveLevels.map((level) => (
              <option key={level.value} value={level.value}>
                {level.label}
              </option>
            ))}
          </select>
        </Field>
      </FieldGrid>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="hasSpace"
          value="1"
          defaultChecked={hasSpaceFilter}
          onChange={submit}
          className="size-4"
        />
        {copy.hasSpace}
      </label>
      {/* Opt-in, and only once a level is stated. Marking rather than hiding is
          the default because a shop will happily take an Open Water diver on an
          Advanced charter as a guided dive, or sell them the specialty — a
          filter that silently removes those trips costs the shop the sale and
          the diver the option. This is for the reader who wants the shorter
          list anyway. */}
      {canDiveFilter ? (
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="hideAbove"
            value="1"
            defaultChecked={hideAboveFilter}
            onChange={submit}
            className="size-4"
          />
          {copy.hideAboveLevel}
        </label>
      ) : null}
      {aboveLevelNotice ? <p className="w-full text-sm text-muted">{aboveLevelNotice}</p> : null}
    </QueryForm>
  );
}
