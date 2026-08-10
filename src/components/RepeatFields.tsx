"use client";

import { useEffect, useId, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { calendarDateWeekday, isValidCalendarDate } from "@/lib/calendar-date";

export type RepeatFieldsCopy = {
  howOftenLabel: string;
  doesntRepeat: string;
  everyWeek: string;
  every2Weeks: string;
  every4Weeks: string;
  repeatsOnLabel: string;
  repeatsOnDescription: string;
  everyDay: string;
  endsLabel: string;
  endsNever: string;
  endsOnChoice: string;
  endsOnLabel: string;
  /**
   * The seven weekday names, Sunday first, already spelled for the request
   * locale. Calendar data rather than sentences, so they come from `Intl` on the
   * server (see the board page) instead of seven keys per language — but they
   * still arrive as props, because a Client Component has no request to
   * negotiate a locale from and the viewer's browser locale is not the shop's.
   */
  weekdayNames: string[];
};

/** Sunday-first day numbers, matching `src/lib/recurrence.ts`'s bit order. */
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/**
 * The cadence a series already runs on, for the editing surface. Absent when
 * this is the create form, which starts from "Doesn't repeat".
 */
export type RepeatFieldsInitial = {
  intervalWeeks: number;
  /** Ascending day numbers, 0 = Sunday. */
  weekdays: number[];
  endsOn: string | null;
};

/**
 * "How often", "Repeats on", and "Ends" — the three questions a repeating
 * departure actually has, and none it doesn't.
 *
 * The count this replaced ("Number of trips") was the old model showing
 * through: a series was a fixed batch of dates, so somebody had to name a total
 * up front. Shops don't run seasons of eight; they run a Saturday charter, and
 * they run it until they stop. So the default here is a run with **no end**,
 * and "Ends" is the exception a shop opts into (ADR
 * 20260810-open-ended-recurring-trips).
 *
 * "Repeats on" is the other half of the same correction. A cadence week can
 * fire on any set of weekdays — Monday and Thursday is one series, not two, and
 * "every day" is simply all seven checked, which is what the shortcut sets. The
 * chosen date's own weekday is pre-checked, so a shop that picks a Saturday and
 * says "every week" gets Saturdays without touching this at all.
 */
export function RepeatFields({
  startDate,
  copy,
  initial,
  disabled = false,
}: {
  /** The departure's own date (`YYYY-MM-DD`), whose weekday seeds the picker. */
  startDate: string;
  copy: RepeatFieldsCopy;
  /**
   * The cadence to open on. Given, this is the *edit* form: it starts on the
   * shop's real answer, drops "Doesn't repeat" (stopping a run is its own
   * control, and not the same act as editing one), and never re-seeds itself
   * from the date.
   */
  initial?: RepeatFieldsInitial;
  /**
   * Inert and out of the submission entirely — for a caller that keeps this
   * block mounted while it is off screen so a chosen cadence survives being
   * hidden. Same reason the fields below are disabled rather than removed.
   */
  disabled?: boolean;
}) {
  const editing = initial !== undefined;
  const [repeats, setRepeats] = useState(editing);
  const [endsOnDate, setEndsOnDate] = useState(initial?.endsOn != null);
  const startWeekday = isValidCalendarDate(startDate) ? calendarDateWeekday(startDate) : null;
  const [weekdays, setWeekdays] = useState<number[]>(
    initial?.weekdays ?? (startWeekday === null ? [] : [startWeekday]),
  );
  const groupId = useId();

  // The picker follows the date field while it is still only a default: a shop
  // that changes the date after choosing a cadence should not have to come back
  // and re-check the new weekday. `touched` is what stops this from ever
  // overwriting an answer somebody actually gave — and an edit form opens on a
  // real answer, so it is touched from the start.
  const [touched, setTouched] = useState(editing);
  useEffect(() => {
    if (touched || startWeekday === null) return;
    setWeekdays([startWeekday]);
  }, [touched, startWeekday]);

  const everyDay = weekdays.length === WEEKDAYS.length;
  const toggleWeekday = (day: number) => {
    setTouched(true);
    setWeekdays((current) =>
      current.includes(day) ? current.filter((value) => value !== day) : [...current, day],
    );
  };

  return (
    <div className="mt-4 flex flex-col gap-5">
      <FieldGrid columns={2} className="gap-y-5">
        <Field label={copy.howOftenLabel}>
          <select
            name="repeatIntervalWeeks"
            defaultValue={String(initial?.intervalWeeks ?? 0)}
            disabled={disabled}
            onChange={(event) => setRepeats(event.currentTarget.value !== "0")}
            className={controlClass}
          >
            {/* Absent while editing: "stop repeating" is its own control on the
                trip page, and it is a different act from changing a cadence —
                offering it here would let a shop end a run by picking an option
                labelled as a frequency. */}
            {editing ? null : <option value="0">{copy.doesntRepeat}</option>}
            <option value="1">{copy.everyWeek}</option>
            <option value="2">{copy.every2Weeks}</option>
            <option value="4">{copy.every4Weeks}</option>
          </select>
        </Field>
        <Field label={copy.endsLabel}>
          <select
            defaultValue={initial?.endsOn == null ? "never" : "on"}
            disabled={disabled || !repeats}
            onChange={(event) => setEndsOnDate(event.currentTarget.value === "on")}
            className={`${controlClass} disabled:cursor-not-allowed disabled:opacity-60`}
          >
            <option value="never">{copy.endsNever}</option>
            <option value="on">{copy.endsOnChoice}</option>
          </select>
        </Field>
      </FieldGrid>

      {/* A fieldset rather than a `<Field>`: seven toggles are one answer, and
          the legend is what tells a screen reader they belong together. */}
      <fieldset disabled={disabled || !repeats} className="disabled:opacity-60">
        <legend className="text-sm font-medium" id={groupId}>
          {copy.repeatsOnLabel}
        </legend>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {WEEKDAYS.map((day) => {
            const on = weekdays.includes(day);
            return (
              <label
                key={day}
                // The checkbox inside is visually hidden, so the focus ring has
                // to be drawn by the chip that stands in for it — otherwise a
                // keyboard user tabs through seven invisible controls.
                className={buttonClass({
                  variant: on ? "primary" : "secondary",
                  size: "sm",
                  className:
                    "min-w-12 rounded-full has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary has-[:focus-visible]:ring-offset-2",
                })}
              >
                {/* The checkbox itself is the state — visually replaced by the
                    chip, never removed, so keyboard focus and the form's own
                    submission both still work. */}
                <input
                  type="checkbox"
                  name="repeatWeekday"
                  value={day}
                  checked={on}
                  onChange={() => toggleWeekday(day)}
                  className="sr-only"
                />
                {copy.weekdayNames[day]}
              </label>
            );
          })}
          <button
            type="button"
            aria-pressed={everyDay}
            onClick={() => {
              setTouched(true);
              setWeekdays(everyDay ? (startWeekday === null ? [] : [startWeekday]) : [...WEEKDAYS]);
            }}
            className={buttonClass({ variant: "ghost", size: "sm", className: "rounded-full" })}
          >
            {copy.everyDay}
          </button>
        </div>
        <p className="mt-2 text-sm text-muted">{copy.repeatsOnDescription}</p>
      </fieldset>

      {endsOnDate ? (
        <Field label={copy.endsOnLabel}>
          <input
            name="repeatEndsOn"
            type="date"
            min={startDate}
            defaultValue={initial?.endsOn ?? undefined}
            required
            disabled={disabled}
            className={controlClass}
          />
        </Field>
      ) : null}
    </div>
  );
}
