"use client";

import { useEffect, useRef, useState } from "react";
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
};

/** The Apply label is bundle copy, but the markup is built by hand. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * The schedule's filter row. Changing a filter *is* the ask — so with JS on,
 * any change submits the form itself and no Apply button renders at all
 * (design/principles.md #10: the action rides on the control, not on a
 * second button the reader must map back to it). With JS off, the
 * `<noscript>` Apply button keeps the server-fed GET reload working. The
 * button used to render for everyone and be removed on hydration, so every
 * real visitor watched it flash in and out beside "Has space"; `<noscript>`
 * trades that flash for a tiny pre-hydration beat where a very fast tap on a
 * filter does nothing yet. The form remains a plain GET either way: the URL
 * carries the filters, and the list below re-renders server-side,
 * pixel-stable for visual regression.
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
      {/* Raw markup, not JSX children: a scripting-enabled browser parses
          noscript content as one text node, so React hydrating real elements
          in there would mismatch. Nothing inside can run JS anyway — a plain
          submit button is the whole no-JS story. */}
      <noscript
        dangerouslySetInnerHTML={{
          __html: `<button type="submit" class="${buttonClass({ variant: "secondary" })}">${escapeHtml(copy.apply)}</button>`,
        }}
      />
    </QueryForm>
  );
}
