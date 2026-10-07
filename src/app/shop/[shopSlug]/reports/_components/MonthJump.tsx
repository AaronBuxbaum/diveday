"use client";

import { useEffect, useRef, useState } from "react";
import { DateField } from "@/components/ui/form";
import { QueryForm } from "@/components/ui/QueryForm";

/**
 * The month box between the report's arrows, applied the moment a month is
 * picked (UX audit 2026-10-07, item 22). It used to need a "Go" button: three
 * controls for one choice. The arrows walk neighbouring months; this box is
 * for a far one (last July was thirteen clicks), and choosing it is the act.
 *
 * A real GET form underneath (`QueryForm`), so before hydration Enter still
 * submits natively. `min` matches the floor the page clamps to server-side, so
 * the box cannot offer a month the page would silently rewrite.
 */
export function MonthJump({
  value,
  min,
  label,
}: {
  /** The month on screen, `YYYY-MM`. */
  value: string;
  /** The shop's first month, `YYYY-MM`. */
  min: string;
  label: string;
}) {
  const form = useRef<HTMLFormElement>(null);
  // For the e2e suite: a pick before hydration has no change handler yet.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return (
    <QueryForm ref={form} replace={false} className="flex items-center">
      <label htmlFor="report-month" className="sr-only">
        {label}
      </label>
      <DateField
        id="report-month"
        type="month"
        name="month"
        defaultValue={value}
        min={min}
        wrapperClassName="w-44"
        data-hydrated={hydrated ? "true" : "false"}
        onChange={(event) => {
          // A half-typed month is empty until it is whole; only a whole,
          // different month is a choice.
          const picked = event.currentTarget.value;
          if (picked && picked !== value) form.current?.requestSubmit();
        }}
      />
    </QueryForm>
  );
}
