"use client";

import { useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { type CourseScheduleDay, MAX_SCHEDULE_DAY_ITEMS, MAX_SCHEDULE_DAYS } from "@/lib/courses";

/**
 * Real per-day controls instead of one textarea round-tripped through an
 * implicit "Day 1 — 8:15am–5:30pm" formatting convention. State lives here and
 * serializes to one hidden JSON field on every change — the surrounding
 * `<form>` (edit/page.tsx) submits it like any other field; `sanitizeScheduleDays`
 * (src/lib/courses.ts) validates it server-side.
 */
export function DayByDayEditor({ initialDays }: { initialDays: CourseScheduleDay[] }) {
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
              <h4 className="font-medium">Day {dayNumber}</h4>
              <button
                type="button"
                onClick={() => removeDay(dayIndex)}
                className={buttonClass({ variant: "danger", size: "sm" })}
              >
                Remove day
              </button>
            </div>

            <FieldGrid columns={1} className="mt-3 gap-y-4">
              <Field label={`Day ${dayNumber} title`}>
                <input
                  value={day.title}
                  onChange={(event) => updateDay(dayIndex, { title: event.target.value })}
                  maxLength={160}
                  placeholder="Classroom and confined water"
                  className={controlClass}
                />
              </Field>
              <FieldGrid columns={2}>
                <Field label={`Day ${dayNumber} start time`} hint="(optional)">
                  <input
                    type="time"
                    value={day.startTime ?? ""}
                    onChange={(event) => updateDay(dayIndex, { startTime: event.target.value })}
                    className={controlClass}
                  />
                </Field>
                <Field label={`Day ${dayNumber} end time`} hint="(optional)">
                  <input
                    type="time"
                    value={day.endTime ?? ""}
                    onChange={(event) => updateDay(dayIndex, { endTime: event.target.value })}
                    className={controlClass}
                  />
                </Field>
              </FieldGrid>
              <Field
                label={`Day ${dayNumber} time note`}
                hint="(optional)"
                description={
                  'For a day with no fixed clock time, e.g. "week 1–2" or "about 3 hours". Ignored when start time is set.'
                }
              >
                <input
                  value={day.timeNote ?? ""}
                  onChange={(event) => updateDay(dayIndex, { timeNote: event.target.value })}
                  maxLength={120}
                  placeholder="about 3 hours"
                  className={controlClass}
                />
              </Field>
            </FieldGrid>

            <div className="mt-4">
              <span className="text-sm font-medium">What happens</span>
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
                      aria-label={`Day ${dayNumber} item ${itemIndex + 1}`}
                      placeholder="Confined water skills"
                      className={controlClass}
                    />
                    <button
                      type="button"
                      onClick={() => removeItem(dayIndex, itemIndex)}
                      aria-label={`Remove day ${dayNumber} item ${itemIndex + 1}`}
                      className={buttonClass({ variant: "ghost", size: "sm" })}
                    >
                      Remove
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
                  ? `${MAX_SCHEDULE_DAY_ITEMS} items max`
                  : "Add item"}
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
        {days.length >= MAX_SCHEDULE_DAYS ? `${MAX_SCHEDULE_DAYS} days max` : "Add day"}
      </button>
    </div>
  );
}
