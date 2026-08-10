"use client";

import { useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { QueryForm } from "@/components/ui/QueryForm";

/**
 * Shown only to a browser with scripting off — see the `<noscript>` below for
 * why this is a markup constant rather than JSX. The default (`display: none`)
 * lives in `src/app/globals.css`.
 */
const NO_JS_REVEAL = "<style>[data-noscript-only]{display:contents}</style>";

export type ScheduleFiltersCopy = {
  tripType: string;
  allTrips: string;
  funDive: string;
  course: string;
  hasSpace: string;
  apply: string;
};

/**
 * The schedule's filter row. Changing a filter *is* the ask — so once
 * hydrated, any change submits the form itself and there is no Apply button to
 * map back to it (design/principles.md #10: the action rides on the control).
 * With JS off the button is there, so the server-fed GET reload keeps working
 * exactly as before; it is hidden from everyone else by CSS rather than
 * removed on hydration, so it never flashes in and out (see the `<noscript>`
 * block below). The form remains a plain GET either way: the URL carries the
 * filters, and the list below re-renders server-side, pixel-stable for visual
 * regression.
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
      {/*
       * Apply is the no-JS fallback, and it used to be removed *on* hydration —
       * so every visitor with JS watched it render and then vanish a beat
       * later, a small horizontal shift beside "Has space" that phone
       * screenshots kept catching mid-flight.
       *
       * It is now hidden by default and revealed only by a stylesheet the
       * browser parses when scripting is off, so a JS visitor never sees it —
       * not after hydration, and not in the moments before it either. The
       * button stays in the server HTML either way, which is what a no-JS GET
       * submit needs.
       *
       * "Needs", not "is enough for": this page currently renders *nothing* to
       * a browser with scripting off. The whole `<main>` streams inside a
       * hidden staging div that an inline script relocates, so a JS-less diver
       * sees `loading.tsx`'s skeleton and never reaches this form at all. That
       * follows from `instant = true` plus a loading boundary, not from
       * anything here, and whether it is worth fixing is a product call — see
       * docs/product/follow-ups/FU-20260810-no-js-renders-only-the-skeleton.md.
       * Keeping the fallback correct costs a span and a CSS rule and is right
       * under every answer to that question.
       *
       * `dangerouslySetInnerHTML` is load-bearing here rather than a shortcut:
       * a browser with scripting enabled parses `<noscript>` content as plain
       * text, so React children in this slot would fail to hydrate and could be
       * re-inserted as live elements — visible to exactly the readers meant
       * never to see them. The markup is a constant with nothing interpolated
       * into it.
       *
       * The trade this accepts, and the reason it was worth a second look: a JS
       * visitor who taps a filter in the gap before hydration now gets nothing
       * instead of a working Apply. That gap is a fraction of a second on the
       * page's own filter row; the flash it replaces was on every single load.
       *
       * A plain `<button>`, not `SubmitButton`: a pending label comes from
       * `useFormStatus`, and the only reader who ever sees this control has no
       * JS to run it. For them a submit is a full document navigation, so there
       * is no in-flight state left to announce.
       */}
      <noscript
        // biome-ignore lint/security/noDangerouslySetInnerHtml: a module-level constant with nothing interpolated into it — and innerHTML is the safe form here, since React children inside <noscript> can hydrate into live elements a JS visitor would see.
        dangerouslySetInnerHTML={{ __html: NO_JS_REVEAL }}
      />
      <span data-noscript-only>
        <button type="submit" className={buttonClass({ variant: "secondary" })}>
          {copy.apply}
        </button>
      </span>
    </QueryForm>
  );
}
