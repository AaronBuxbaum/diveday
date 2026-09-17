"use client";

import { useEffect, useRef, useState } from "react";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { QueryForm } from "@/components/ui/QueryForm";

export type ScheduleFiltersCopy = {
  /** The one word the rail shows at rest, on the disclosure that holds the rest. */
  disclosure: string;
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
 * The schedule's filters, behind one word.
 *
 * At rest this is a quiet "Filter" line under the shop's own lens chips, and
 * that is the whole rail. Open, it is the four controls it has always been.
 * They stood in the open until 2026-09-17, which put ten or eleven controls
 * above a list a diver had not begun reading — seven chips, two selects, one
 * or two checkboxes and a sentence — on a conversion surface whose one job is
 * to get somebody onto a boat (principle 8: collapse the rare path; principle
 * 10: remove until it breaks). The chips are the shop's own words for its
 * kinds of day and stay out; these four are the advanced ask.
 *
 * **Open when the reader is already filtering.** A URL carrying any of the
 * four parameters — a shared link, a reload, a step back — opens the
 * disclosure on first paint, so nothing narrowing the list below is ever
 * hidden from the person looking at it. After that it is theirs: the state is
 * the reader's, not the URL's, so clearing the last filter does not shut the
 * panel under their finger.
 *
 * **The disclosure lives inside the `<form>`, not around it.** Seven
 * assertions across `e2e/schedule-filters.spec.ts`, `e2e/schedule-lenses.spec.ts`
 * and `e2e/trip-admission.spec.ts` address the departures as the `ul`
 * immediately after this form. A `<details>` wrapping the form would put an
 * element between the two and break every one of them silently. Controls
 * inside a closed `<details>` still submit, so nothing about the GET changes.
 *
 * Changing a filter *is* the ask, so any change
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
  lens,
  tripTypeFilter,
  hasSpaceFilter,
  canDiveFilter,
  hideAboveFilter,
  copy,
}: {
  embed: boolean;
  month: string | null;
  /**
   * The lens the reader is looking through, or null. Carried as a hidden input
   * below for the same reason `month` is: this is a GET form, so any parameter
   * it does not carry is **erased** on submit — and one tap of "Has space"
   * would otherwise hand back the whole board with the rail reset to "Every
   * departure" and nothing saying why.
   */
  lens: string | null;
  tripTypeFilter: string | null;
  hasSpaceFilter: boolean;
  /**
   * The level the reader has stated, or null for unsaid. A **stated
   * preference**, never a gate: it dims and counts, and nothing downstream of it
   * touches admission or readiness (issue #696).
   */
  canDiveFilter: string | null;
  hideAboveFilter: boolean;
  copy: ScheduleFiltersCopy;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  // Seeded from the URL, then owned by the reader. `useState` rather than a
  // derived `open={…}`: a controlled attribute would slam the panel shut the
  // moment somebody cleared their last filter, which is the one instant they
  // are most likely to want another.
  const [open, setOpen] = useState(
    Boolean(tripTypeFilter || hasSpaceFilter || canDiveFilter || hideAboveFilter),
  );
  const submit = () => formRef.current?.requestSubmit();

  return (
    <QueryForm ref={formRef} className="mb-6">
      {embed ? <input type="hidden" name="embed" value="1" /> : null}
      {month ? <input type="hidden" name="month" value={month} /> : null}
      {lens ? <input type="hidden" name="lens" value={lens} /> : null}
      <details
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
        className="group/filters"
      >
        <summary className="-mx-2 inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-2 text-sm font-medium text-muted select-none transition-brand [&::-webkit-details-marker]:hidden hover:text-primary">
          <DisclosureCaret className="group-open/filters:rotate-90" />
          {copy.disclosure}
        </summary>
        <div className="mt-3 flex flex-wrap items-end gap-3">
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
        </div>
      </details>
    </QueryForm>
  );
}
