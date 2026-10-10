"use client";

import { useEffect, useRef, useState } from "react";
import { controlClass } from "@/components/ui/form";
import { QueryForm } from "@/components/ui/QueryForm";

/**
 * The month list between the report's arrows, applied the moment a month is
 * picked (UX audit 2026-10-07, item 22). It used to need a "Go" button: three
 * controls for one choice. The arrows walk neighbouring months; this list is
 * for a far one (last July was thirteen clicks), and choosing it is the act.
 *
 * **A `<select>` of the shop's months, not `<input type="month">`** (#1983).
 * The native box drew its month in the *browser's* language inside a fixed
 * width, so "September 2026" lost its year at 160px and a Spanish browser's
 * "septiembre de 2026" fit no width the row could give at 390. The options
 * are labelled by the page in the shop's language, and a select is as wide
 * as its longest option. What that costs is the desktop's native month grid;
 * a phone's picker was a full-screen sheet either way.
 *
 * A real GET form underneath (`QueryForm`), so before hydration the form still
 * submits natively. The months run from the floor the page clamps to
 * server-side, so the list cannot offer a month the page would silently
 * rewrite, and the `month=YYYY-MM` it submits is what `parseMonthKey` reads.
 */
export function MonthJump({
  value,
  months,
  label,
}: {
  /** The month on screen, `YYYY-MM`. */
  value: string;
  /** Every month the page can show, newest first, each already in the shop's language. */
  months: ReadonlyArray<{ value: string; label: string }>;
  label: string;
}) {
  const form = useRef<HTMLFormElement>(null);
  // For the e2e suite: a pick before hydration has no change handler yet.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return (
    // The form is a flex item sized by its content, so the select's `w-full`
    // (from `controlClass`) is the width of its longest month and no wider.
    <QueryForm ref={form} replace={false} className="flex items-center">
      <label htmlFor="report-month" className="sr-only">
        {label}
      </label>
      <select
        id="report-month"
        name="month"
        defaultValue={value}
        className={`${controlClass} tabular-nums`}
        data-hydrated={hydrated ? "true" : "false"}
        onChange={(event) => {
          const picked = event.currentTarget.value;
          if (picked && picked !== value) form.current?.requestSubmit();
        }}
      >
        {months.map((month) => (
          <option key={month.value} value={month.value}>
            {month.label}
          </option>
        ))}
      </select>
    </QueryForm>
  );
}
