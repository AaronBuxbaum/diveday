"use client";

import { useEffect, useRef, useState } from "react";
import { controlClass, DateField, Field } from "@/components/ui/form";
import { fill } from "@/i18n/fill";
import { MAX_MEETING_DAY_GAP_DAYS } from "@/lib/trip-days";

export type MeetingDaysCopy = {
  daysLabel: string;
  daysDescription?: string;
  /** "Day {number}", raw: filled here per later day. */
  dayLabel: string;
};

/** Whole days from `from` to `to`, both `YYYY-MM-DD`; NaN when either is not a date. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** `date` moved by `days`, as `YYYY-MM-DD`; empty when `date` is not one. */
function shifted(date: string, days: number): string {
  const at = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(at)) return "";
  return new Date(at + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * **How many days, and on which dates** (third UX review, item 10).
 *
 * The count is the box it always was; past one day, a date box per later day
 * appears, filled with the next consecutive dates. Change one to put a gap in
 * the run (an Open Water course on Sat/Sun, Sat/Sun, Sat) and the departure
 * stays one trip with one roster. The later days are held as offsets from day
 * one, so moving the form's own `date` box moves every day with it, gaps kept,
 * the way a board move does. The server re-checks the order and the span
 * (`meetingDaysFor`); this only fills the boxes.
 *
 * **Held back for now.** The date boxes appear only once a day may follow the
 * one before it by more than a day (`MAX_MEETING_DAY_GAP_DAYS`): until Today
 * and the roll call read a departure's meeting days, a gap would read as days
 * on the water, so the form asks for the count alone and the days run back to
 * back. `namedDates` overrides it for the field's own tests.
 *
 * Shared by the board's add panel and the departure's edit form, and finds day
 * one through its own form's `date` input rather than a prop, so neither form
 * has to lift its date into state for it.
 */
export function MeetingDaysField({
  copy,
  minDays,
  maxDays,
  defaultCount,
  defaultLaterDates = [],
  disabled = false,
  namedDates = MAX_MEETING_DAY_GAP_DAYS > 1,
  className,
}: {
  copy: MeetingDaysCopy;
  minDays: number;
  maxDays: number;
  defaultCount: number;
  /** The stored later days, when they are not consecutive; empty otherwise. */
  defaultLaterDates?: readonly string[];
  /** The add panel's collapsed state: nothing submitted, nothing required. */
  disabled?: boolean;
  /** Offer a date box per later day. Defaults to whether a gap is allowed at all. */
  namedDates?: boolean;
  className?: string;
}) {
  const countRef = useRef<HTMLInputElement>(null);
  const [firstDate, setFirstDate] = useState<string | null>(null);
  const [count, setCount] = useState(defaultCount);
  // Offsets from day one, one per later day. Seeded from the stored dates once
  // day one is known; until then the consecutive run.
  const [offsets, setOffsets] = useState<number[] | null>(null);
  const seed = useRef(defaultLaterDates);

  useEffect(() => {
    const input = countRef.current?.form?.elements.namedItem("date");
    if (!(input instanceof HTMLInputElement)) return;
    const read = () => setFirstDate(input.value || null);
    read();
    input.addEventListener("input", read);
    input.addEventListener("change", read);
    return () => {
      input.removeEventListener("input", read);
      input.removeEventListener("change", read);
    };
  }, []);

  useEffect(() => {
    if (offsets !== null || !firstDate) return;
    const stored = seed.current
      .map((date) => daysBetween(firstDate, date))
      .filter((offset) => Number.isFinite(offset));
    setOffsets(stored.length > 0 ? stored : []);
  }, [firstDate, offsets]);

  const later = Math.max(0, Math.min(count, maxDays) - 1);
  const current = offsets ?? [];
  // A day with no date yet is the day after the one before it.
  const laterOffsets: number[] = [];
  for (let index = 0; index < later; index += 1) {
    laterOffsets.push(current[index] ?? (laterOffsets[index - 1] ?? 0) + 1);
  }

  const setOffset = (index: number, date: string) => {
    if (!firstDate) return;
    const offset = daysBetween(firstDate, date);
    if (!Number.isFinite(offset)) return;
    const next = [...laterOffsets];
    next[index] = offset;
    setOffsets(next);
  };

  return (
    <div className={className}>
      <Field label={copy.daysLabel} description={copy.daysDescription}>
        <input
          ref={countRef}
          name="dayCount"
          type="number"
          required={!disabled}
          disabled={disabled}
          min={minDays}
          max={maxDays}
          value={count}
          onChange={(event) => {
            const value = Number(event.currentTarget.value);
            setCount(Number.isFinite(value) ? value : minDays);
            setOffsets(laterOffsets.slice(0, Math.max(0, value - 1)));
          }}
          className={`${controlClass} tabular-nums max-w-40`}
        />
      </Field>
      {namedDates && later > 0 && firstDate ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {laterOffsets.map((offset, index) => (
            <Field
              // biome-ignore lint/suspicious/noArrayIndexKey: a day's position is its identity
              key={index}
              label={fill(copy.dayLabel, { number: index + 2 })}
            >
              <DateField
                name="meetingDate"
                required={!disabled}
                disabled={disabled}
                value={shifted(firstDate, offset)}
                onChange={(event) => setOffset(index, event.currentTarget.value)}
              />
            </Field>
          ))}
        </div>
      ) : null}
    </div>
  );
}
