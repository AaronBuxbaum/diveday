"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { DateField, Field, FieldGrid } from "@/components/ui/form";
import { QueryForm } from "@/components/ui/QueryForm";

/** How long a typed date settles before the free units are read again. */
const SETTLE_MS = 350;

/**
 * **When** — the rental's window, read again as the dates change.
 *
 * There is no "show what's free" button: a date that is whole and valid
 * re-renders the page through `QueryForm` (a router replace, scroll kept), so
 * the units below always answer for the dates on screen. A short settle
 * absorbs typing digit by digit, where "2" is briefly the year 0002. A start
 * moved past the return date drags the return date with it, the way a
 * one-day rental grows into two.
 */
export function RentalWindowFields({
  personId,
  from,
  until,
  todayLocal,
  fromLabel,
  untilLabel,
  status,
}: {
  personId: string;
  from: string;
  until: string;
  todayLocal: string;
  fromLabel: string;
  untilLabel: string;
  /** The day count, or why these dates are refused: drawn by the server for the dates in the URL. */
  status: ReactNode;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const untilRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const settle = (input: HTMLInputElement) => {
    clearTimeout(timer.current);
    if (!input.value || !input.validity.valid) return;
    timer.current = setTimeout(() => formRef.current?.requestSubmit(), SETTLE_MS);
  };

  return (
    <QueryForm ref={formRef} keep={{ personId }}>
      <FieldGrid columns={2}>
        <Field label={fromLabel}>
          <DateField
            name="from"
            defaultValue={from}
            min={todayLocal}
            required
            onChange={(event) => {
              const input = event.currentTarget;
              const back = untilRef.current;
              if (back && input.value) {
                back.min = input.value;
                if (back.value && back.value < input.value) back.value = input.value;
              }
              settle(input);
            }}
          />
        </Field>
        <Field label={untilLabel}>
          <DateField
            ref={untilRef}
            name="until"
            defaultValue={until}
            min={from}
            required
            onChange={(event) => settle(event.currentTarget)}
          />
        </Field>
      </FieldGrid>
      <div className="mt-3 text-sm">{status}</div>
    </QueryForm>
  );
}
