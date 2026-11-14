"use client";

import { useEffect, useRef, useState } from "react";
import { controlClass, DateField, Field } from "@/components/ui/form";
import { fill } from "@/i18n/fill";
import { MAX_MEETING_DAY_GAP_DAYS, type MeetingDayHours } from "@/lib/trip-days";

export type MeetingDaysCopy = {
  daysLabel: string;
  daysDescription?: string;
  /** "Day {number}", raw: filled here per later day. */
  dayLabel: string;
  /** "Day {number} departs", raw: a later day's own start time (#2558). */
  dayStartLabel: string;
  /** "Day {number} returns", raw. */
  dayEndLabel: string;
};

/** Follow one of the form's own inputs by name; `null` until it has a value. */
function useFormValue(anchor: React.RefObject<HTMLInputElement | null>, name: string) {
  const [value, setValue] = useState<string | null>(null);
  useEffect(() => {
    const input = anchor.current?.form?.elements.namedItem(name);
    if (!(input instanceof HTMLInputElement)) return;
    const read = () => setValue(input.value || null);
    read();
    input.addEventListener("input", read);
    input.addEventListener("change", read);
    return () => {
      input.removeEventListener("input", read);
      input.removeEventListener("change", read);
    };
  }, [anchor, name]);
  return value;
}

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
 * **Hours per day** (#2558). Each later day carries its own departs and
 * returns boxes, showing the form's own until one is changed: a pool night
 * at 18:00 and an open-water Saturday at 08:00 are one course. A day that
 * follows day one's posts empty hours, so the server takes day one's as
 * submitted rather than a copy this field may have read before the staffer
 * typed into a box that changes without an input event (the board's
 * `ForgivingInput`). The server re-checks each day's hours (`meetingDaysFor`).
 *
 * The date boxes are offered while a day may follow the one before it by more
 * than a day (`MAX_MEETING_DAY_GAP_DAYS`, the whole span since Today and the
 * roll call read a departure's meeting days, #2557).
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
  defaultLaterHours = [],
  defaultMeetingIds,
  defaultMeetingVersion,
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
  /** The stored later days' own hours, one pair per later day; empty for day one's. */
  defaultLaterHours?: readonly MeetingDayHours[];
  /** Existing identities, submitted only by the departure editor. */
  defaultMeetingIds?: readonly string[];
  defaultMeetingVersion?: string;
  /** The add panel's collapsed state: nothing submitted, nothing required. */
  disabled?: boolean;
  /** Offer a date box per later day. Defaults to whether a gap is allowed at all. */
  namedDates?: boolean;
  className?: string;
}) {
  const countRef = useRef<HTMLInputElement>(null);
  const firstDate = useFormValue(countRef, "date");
  const firstStart = useFormValue(countRef, "startTime");
  const firstEnd = useFormValue(countRef, "endTime");
  const [count, setCount] = useState(defaultCount);
  const meetingIds = defaultMeetingIds ?? [];
  // Offsets from day one, one per later day. Seeded from the stored dates once
  // day one is known; until then the consecutive run.
  const [offsets, setOffsets] = useState<number[] | null>(null);
  const seed = useRef(defaultLaterDates);
  // A later day's own hours, or null where it follows day one's. Seeded from
  // the stored days: one that keeps day one's hours goes on following them.
  const [hours, setHours] = useState<(MeetingDayHours | null)[] | null>(null);
  const hoursSeed = useRef(defaultLaterHours);
  useEffect(() => {
    if (hours !== null || firstStart === null || firstEnd === null) return;
    setHours(
      hoursSeed.current.map((day) =>
        day.start === firstStart && day.end === firstEnd ? null : day,
      ),
    );
  }, [firstStart, firstEnd, hours]);

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

  const ownHours = hours ?? [];
  const setHour = (index: number, edge: "start" | "end", value: string) => {
    const next = laterOffsets.map((_, day) => ownHours[day] ?? null);
    const current = next[index] ?? { start: firstStart ?? "", end: firstEnd ?? "" };
    next[index] = { ...current, [edge]: value };
    setHours(next);
  };

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
            setHours(ownHours.slice(0, Math.max(0, value - 1)));
          }}
          className={`${controlClass} tabular-nums max-w-40`}
        />
      </Field>
      {defaultMeetingIds ? (
        <>
          <input type="hidden" name="meetingIdsPresent" value="1" disabled={disabled} />
          <input
            type="hidden"
            name="expectedMeetingVersion"
            value={defaultMeetingVersion ?? ""}
            disabled={disabled}
          />
          {defaultMeetingIds.map((id) => (
            <input key={id} type="hidden" name="expectedMeetingId" value={id} disabled={disabled} />
          ))}
          {Array.from({ length: Math.max(0, Math.min(count, maxDays)) }, (_, index) => (
            <input
              // biome-ignore lint/suspicious/noArrayIndexKey: the hidden slot's position is its form identity.
              key={index}
              type="hidden"
              name="meetingId"
              value={meetingIds[index] ?? ""}
              disabled={disabled}
            />
          ))}
        </>
      ) : null}
      {namedDates && later > 0 && firstDate ? (
        <div className="mt-4 space-y-4">
          {laterOffsets.map((offset, index) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: a day's position is its identity
              key={index}
              className="grid gap-4 sm:grid-cols-3"
            >
              <Field label={fill(copy.dayLabel, { number: index + 2 })}>
                <DateField
                  name="meetingDate"
                  required={!disabled}
                  disabled={disabled}
                  value={shifted(firstDate, offset)}
                  onChange={(event) => setOffset(index, event.currentTarget.value)}
                />
              </Field>
              <Field label={fill(copy.dayStartLabel, { number: index + 2 })}>
                <DateField
                  type="time"
                  required={!disabled && ownHours[index] != null}
                  disabled={disabled}
                  value={ownHours[index]?.start ?? firstStart ?? ""}
                  onChange={(event) => setHour(index, "start", event.currentTarget.value)}
                />
                <input
                  type="hidden"
                  name="meetingStart"
                  disabled={disabled}
                  value={ownHours[index]?.start ?? ""}
                />
              </Field>
              <Field label={fill(copy.dayEndLabel, { number: index + 2 })}>
                <DateField
                  type="time"
                  required={!disabled && ownHours[index] != null}
                  disabled={disabled}
                  value={ownHours[index]?.end ?? firstEnd ?? ""}
                  onChange={(event) => setHour(index, "end", event.currentTarget.value)}
                />
                <input
                  type="hidden"
                  name="meetingEnd"
                  disabled={disabled}
                  value={ownHours[index]?.end ?? ""}
                />
              </Field>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
