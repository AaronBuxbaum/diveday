"use client";

import { useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { type CourseScheduleDay, MAX_SCHEDULE_DAY_ITEMS, MAX_SCHEDULE_DAYS } from "@/lib/courses";

/**
 * Every value is a plain ICU-style template string (e.g. "Day {number}"),
 * never a function — the day/item counts are unbounded and change purely
 * client-side (add/remove row), so there is no fixed set of server-rendered
 * strings to hand down. `fill()` below does the one-level `{token}`
 * substitution locally, entirely within the client bundle; no translator
 * function ever crosses the Server->Client boundary.
 */
export interface DayByDayEditorCopy {
  dayLabel: string;
  removeDay: string;
  dayTitleLabel: string;
  dayTitlePlaceholder: string;
  startTimeLabel: string;
  endTimeLabel: string;
  timeNoteLabel: string;
  timeNoteDescription: string;
  timeNotePlaceholder: string;
  whatHappens: string;
  itemLabel: string;
  removeItemLabel: string;
  itemPlaceholder: string;
  remove: string;
  itemsMax: string;
  addItem: string;
  daysMax: string;
  addDay: string;
  optionalHint: string;
}

/** One-level `{token}` substitution — not a translator, just string.replace. */
function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    key in values ? String(values[key]) : match,
  );
}

/**
 * Real per-day controls instead of one textarea round-tripped through an
 * implicit "Day 1 — 8:15am–5:30pm" formatting convention. State lives here and
 * serializes to one hidden JSON field on every change — the surrounding
 * `<form>` (edit/page.tsx) submits it like any other field; `sanitizeScheduleDays`
 * (src/lib/courses.ts) validates it server-side.
 */
export function DayByDayEditor({
  initialDays,
  copy,
}: {
  initialDays: CourseScheduleDay[];
  copy: DayByDayEditorCopy;
}) {
  const [days, setDays] = useState<CourseScheduleDay[]>(initialDays);

  function updateDay(index: number, patch: Partial<CourseScheduleDay>) {
    setDays((current) => current.map((day, i) => (i === index ? { ...day, ...patch } : day)));
  }

  function addDay() {
    setDays((current) => [...current, { title: "", items: [] }]);
  }

  function removeDay(index: number) {
    setDays((current) => current.filter((_, i) => i !== index));
  }

  function updateItem(dayIndex: number, itemIndex: number, value: string) {
    setDays((current) =>
      current.map((day, i) =>
        i === dayIndex
          ? { ...day, items: day.items.map((item, j) => (j === itemIndex ? value : item)) }
          : day,
      ),
    );
  }

  function addItem(dayIndex: number) {
    setDays((current) =>
      current.map((day, i) => (i === dayIndex ? { ...day, items: [...day.items, ""] } : day)),
    );
  }

  function removeItem(dayIndex: number, itemIndex: number) {
    setDays((current) =>
      current.map((day, i) =>
        i === dayIndex ? { ...day, items: day.items.filter((_, j) => j !== itemIndex) } : day,
      ),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <input type="hidden" name="scheduleDaysJson" value={JSON.stringify(days)} />
      {days.map((day, dayIndex) => {
        const dayNumber = dayIndex + 1;
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable id and are only ever appended/removed by position, never reordered.
            key={dayIndex}
            className="rounded-xl border border-border p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <h4 className="font-medium">{fill(copy.dayLabel, { number: dayNumber })}</h4>
              <button
                type="button"
                onClick={() => removeDay(dayIndex)}
                className={buttonClass({ variant: "danger", size: "sm" })}
              >
                {copy.removeDay}
              </button>
            </div>

            <FieldGrid columns={1} className="mt-3 gap-y-4">
              <Field label={fill(copy.dayTitleLabel, { number: dayNumber })}>
                <input
                  value={day.title}
                  onChange={(event) => updateDay(dayIndex, { title: event.target.value })}
                  maxLength={160}
                  placeholder={copy.dayTitlePlaceholder}
                  className={controlClass}
                />
              </Field>
              <FieldGrid columns={2}>
                <Field
                  label={fill(copy.startTimeLabel, { number: dayNumber })}
                  hint={copy.optionalHint}
                >
                  <input
                    type="time"
                    value={day.startTime ?? ""}
                    onChange={(event) => updateDay(dayIndex, { startTime: event.target.value })}
                    className={controlClass}
                  />
                </Field>
                <Field
                  label={fill(copy.endTimeLabel, { number: dayNumber })}
                  hint={copy.optionalHint}
                >
                  <input
                    type="time"
                    value={day.endTime ?? ""}
                    onChange={(event) => updateDay(dayIndex, { endTime: event.target.value })}
                    className={controlClass}
                  />
                </Field>
              </FieldGrid>
              <Field
                label={fill(copy.timeNoteLabel, { number: dayNumber })}
                hint={copy.optionalHint}
                description={copy.timeNoteDescription}
              >
                <input
                  value={day.timeNote ?? ""}
                  onChange={(event) => updateDay(dayIndex, { timeNote: event.target.value })}
                  maxLength={120}
                  placeholder={copy.timeNotePlaceholder}
                  className={controlClass}
                />
              </Field>
            </FieldGrid>

            <div className="mt-4">
              <span className="text-sm font-medium">{copy.whatHappens}</span>
              <div className="mt-2 flex flex-col gap-2">
                {day.items.map((item, itemIndex) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable id and are only ever appended/removed by position, never reordered.
                    key={itemIndex}
                    className="flex items-center gap-2"
                  >
                    <input
                      value={item}
                      onChange={(event) => updateItem(dayIndex, itemIndex, event.target.value)}
                      maxLength={200}
                      aria-label={fill(copy.itemLabel, { number: dayNumber, index: itemIndex + 1 })}
                      placeholder={copy.itemPlaceholder}
                      className={controlClass}
                    />
                    <button
                      type="button"
                      onClick={() => removeItem(dayIndex, itemIndex)}
                      aria-label={fill(copy.removeItemLabel, {
                        number: dayNumber,
                        index: itemIndex + 1,
                      })}
                      className={buttonClass({ variant: "ghost", size: "sm" })}
                    >
                      {copy.remove}
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => addItem(dayIndex)}
                disabled={day.items.length >= MAX_SCHEDULE_DAY_ITEMS}
                className={buttonClass({ variant: "secondary", size: "sm", className: "mt-2" })}
              >
                {day.items.length >= MAX_SCHEDULE_DAY_ITEMS
                  ? fill(copy.itemsMax, { max: MAX_SCHEDULE_DAY_ITEMS })
                  : copy.addItem}
              </button>
            </div>
          </div>
        );
      })}
      <button
        type="button"
        onClick={addDay}
        disabled={days.length >= MAX_SCHEDULE_DAYS}
        className={buttonClass({ variant: "secondary", className: "self-start" })}
      >
        {days.length >= MAX_SCHEDULE_DAYS
          ? fill(copy.daysMax, { max: MAX_SCHEDULE_DAYS })
          : copy.addDay}
      </button>
    </div>
  );
}
