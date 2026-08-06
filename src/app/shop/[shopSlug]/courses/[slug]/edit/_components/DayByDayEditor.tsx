"use client";

import { useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { fill } from "@/i18n/fill";
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
  timeNoteTitle: string;
  timeNotePlaceholder: string;
  whatHappens: string;
  /** "One item per line." — the same line the Included/Not included boxes carry. */
  whatHappensHint: string;
  itemsPlaceholder: string;
  itemsOverMax: string;
  daysMax: string;
  addDay: string;
}

/**
 * Items that would actually be stored — blank lines don't count, because
 * `sanitizeScheduleDays` drops them before the cap is applied server-side.
 * Warning on a trailing newline would be a warning about nothing.
 */
function countItems(items: string[]): number {
  return items.filter((item) => item.trim()).length;
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

  /**
   * One item per line, the same shape the Included / Not included boxes use.
   *
   * Split without trimming or dropping blanks: the textarea's value is rebuilt
   * from this array on every keystroke, so filtering here would delete the
   * newline a staffer just pressed before they could type the next item.
   * `sanitizeScheduleDays` (src/lib/courses.ts) does the trimming and blank-line
   * dropping server-side, where it cannot fight the cursor.
   */
  function updateItems(dayIndex: number, value: string) {
    setDays((current) =>
      current.map((day, i) => (i === dayIndex ? { ...day, items: value.split("\n") } : day)),
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
                <Field label={fill(copy.startTimeLabel, { number: dayNumber })}>
                  <input
                    type="time"
                    value={day.startTime ?? ""}
                    onChange={(event) => updateDay(dayIndex, { startTime: event.target.value })}
                    className={controlClass}
                  />
                </Field>
                <Field label={fill(copy.endTimeLabel, { number: dayNumber })}>
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
                description={copy.timeNoteDescription}
              >
                <input
                  value={day.timeNote ?? ""}
                  onChange={(event) => updateDay(dayIndex, { timeNote: event.target.value })}
                  maxLength={120}
                  placeholder={copy.timeNotePlaceholder}
                  title={copy.timeNoteTitle}
                  className={controlClass}
                />
              </Field>
            </FieldGrid>

            {/* One item per line, matching the Included / Not included boxes
                above it. A row of inputs with its own Add/Remove buttons made
                a five-item day a five-click build and let the page grow a
                second, competing idea of what "a list" is; a textarea is the
                one the editor already had. Over-cap is warned about rather
                than truncated — silently eating a typed line is worse than a
                save the server refuses, and it refuses by anchoring here. */}
            {/* Its own FieldGrid, not a bare div: `Field` subgrids its caption
                and control onto the two rows a grid parent declares, and
                outside one the two-row shape it promises has nothing to sit
                on (docs/design/forms-and-controls.md). */}
            <FieldGrid columns={1} className="mt-4">
              <Field
                label={fill(copy.whatHappens, { number: dayNumber })}
                description={copy.whatHappensHint}
                error={
                  countItems(day.items) > MAX_SCHEDULE_DAY_ITEMS
                    ? fill(copy.itemsOverMax, { max: MAX_SCHEDULE_DAY_ITEMS })
                    : undefined
                }
              >
                <textarea
                  value={day.items.join("\n")}
                  onChange={(event) => updateItems(dayIndex, event.target.value)}
                  rows={6}
                  maxLength={MAX_SCHEDULE_DAY_ITEMS * 200}
                  placeholder={copy.itemsPlaceholder}
                  className={controlClass}
                />
              </Field>
            </FieldGrid>
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
