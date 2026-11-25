"use client";

import { useState } from "react";
import { SummaryCaret } from "@/components/ui/disclosure";
import { DateField, Field } from "@/components/ui/form";
import type { ExecutedDive } from "@/db/schema";
import { shiftCalendarDate } from "@/lib/calendar-date";
import { utcToWallTime } from "@/lib/zoned";
import { INLINE_SUMMARY } from "../../_components/trip-ink";
import type { ExecutedDiveLabels } from "./ExecutedDiveLog";

function dateTimeValue(value: Date | null, timeZone: string) {
  if (!value) return "";
  const wall = utcToWallTime(value, timeZone);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${wall.year}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}`;
}

/** A date is requested only when the departure date cannot safely identify the dive. */
export function DiveTimeFields({
  row,
  timeZone,
  tripDate,
  tripStartTime,
  multiDay,
  labels,
  timesError,
}: {
  row?: ExecutedDive;
  timeZone: string;
  tripDate: string;
  tripStartTime: string;
  multiDay: boolean;
  labels: ExecutedDiveLabels;
  timesError: boolean;
}) {
  const initialEntry = dateTimeValue(row?.enteredAt ?? null, timeZone);
  const initialExit = dateTimeValue(row?.exitedAt ?? null, timeZone);
  const [entry, setEntry] = useState(initialEntry.slice(11));
  const [exit, setExit] = useState(initialExit.slice(11));
  const [date, setDate] = useState(
    initialEntry.slice(0, 10) || initialExit.slice(0, 10) || (multiDay ? "" : tripDate),
  );
  const [confirmed, setConfirmed] = useState(Boolean(initialEntry || initialExit));
  const firstTime = entry || exit;
  const effectiveDate =
    !multiDay && !confirmed && tripStartTime && firstTime && firstTime < tripStartTime
      ? shiftCalendarDate(date, 1)
      : date;
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const overnightMinutes =
    entry && exit && exit < entry ? 1440 - minutes(entry) + minutes(exit) : 0;
  const crossesMidnight = overnightMinutes > 0 && overnightMinutes <= 120;
  const enteredAt = effectiveDate && entry ? `${effectiveDate}T${entry}` : "";
  const unchangedRecordedExit =
    initialExit &&
    exit === initialExit.slice(11) &&
    effectiveDate === (initialEntry.slice(0, 10) || initialExit.slice(0, 10));
  const exitDay = unchangedRecordedExit
    ? initialExit.slice(0, 10)
    : crossesMidnight
      ? shiftCalendarDate(effectiveDate, 1)
      : effectiveDate;
  const exitedAt = effectiveDate && exit ? `${exitDay}T${exit}` : "";
  const dateInput = (value: string, required: boolean) => (
    <Field label={labels.diveDate} hint={required ? undefined : labels.optional}>
      <DateField
        type="date"
        value={value}
        required={required}
        onChange={(event) => {
          setDate(event.target.value);
          setConfirmed(Boolean(event.target.value));
        }}
      />
    </Field>
  );
  return (
    <>
      <input type="hidden" name="enteredAt" value={enteredAt} />
      <input type="hidden" name="exitedAt" value={exitedAt} />
      {multiDay ? (
        dateInput(date, Boolean(entry || exit))
      ) : (
        <details className="group/date sm:col-span-2">
          <summary className={`${INLINE_SUMMARY} text-sm`}>
            <SummaryCaret className="group-open/date:rotate-90" />
            {labels.changeDiveDate}
          </summary>
          {dateInput(effectiveDate, false)}
        </details>
      )}
      <Field
        label={labels.enteredAt}
        hint={labels.optional}
        error={timesError ? labels.refusals.times_transposed : undefined}
      >
        <DateField type="time" value={entry} onChange={(event) => setEntry(event.target.value)} />
      </Field>
      <Field
        label={labels.exitedAt}
        hint={labels.optional}
        error={timesError ? labels.refusals.times_transposed : undefined}
      >
        <DateField type="time" value={exit} onChange={(event) => setExit(event.target.value)} />
      </Field>
    </>
  );
}
