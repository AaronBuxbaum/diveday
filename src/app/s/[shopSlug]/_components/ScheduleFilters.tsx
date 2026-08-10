"use client";

import { useEffect, useRef, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { QueryForm } from "@/components/ui/QueryForm";

export type ScheduleFiltersCopy = {
  tripType: string;
  allTrips: string;
  funDive: string;
  course: string;
  hasSpace: string;
  apply: string;
  applying: string;
};

/**
 * The schedule's filter row. Changing a filter *is* the ask — so once
 * hydrated, any change submits the form itself and the Apply button steps
 * aside (design/principles.md #10: the action rides on the control, not on a
 * second button the reader must map back to it). Until hydration — and with
 * JS off — the button stays, so the server-fed GET reload keeps working
 * exactly as before. The form remains a plain GET either way: the URL carries
 * the filters, and the list below re-renders server-side, pixel-stable for
 * visual regression.
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
  copy,
}: {
  embed: boolean;
  month: string | null;
  tripTypeFilter: string | null;
  hasSpaceFilter: boolean;
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
      {hydrated ? null : (
        <SubmitButton
          pendingLabel={copy.applying}
          className={buttonClass({ variant: "secondary" })}
        >
          {copy.apply}
        </SubmitButton>
      )}
    </QueryForm>
  );
}
