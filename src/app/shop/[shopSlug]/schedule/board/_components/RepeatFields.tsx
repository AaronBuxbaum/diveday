"use client";

import { useState } from "react";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";

export type RepeatFieldsCopy = {
  howOftenLabel: string;
  doesntRepeat: string;
  everyWeek: string;
  every2Weeks: string;
  every4Weeks: string;
  numberOfTripsLabel: string;
  numberOfTripsDescription: string;
  numberOfTripsPlaceholder: string;
};

/**
 * "How often" and "Number of trips", where the second only exists once the
 * first says it does.
 *
 * The count used to default to 8 next to a cadence defaulting to "Doesn't
 * repeat", with helper text apologising that the number was "Ignored when it
 * doesn't repeat" — a filled-in box that does nothing, on a form whose other
 * pre-filled numbers (capacity, dives) all take effect. Worse in the other
 * direction: a shop that picked "Every week" and never touched the count got
 * eight departures because a box they never filled in had an opinion.
 *
 * So: blank and disabled until a cadence is chosen, then required. The number
 * is only ever on screen as an answerable question, and every value it holds
 * is one somebody typed.
 */
export function RepeatFields({
  minOccurrences,
  maxOccurrences,
  copy,
  disabled = false,
}: {
  minOccurrences: number;
  maxOccurrences: number;
  copy: RepeatFieldsCopy;
  /**
   * Inert and out of the submission entirely — for a caller that keeps this
   * block mounted while it is off screen so a chosen cadence survives being
   * hidden. Same reason the count below is disabled rather than removed.
   */
  disabled?: boolean;
}) {
  const [repeats, setRepeats] = useState(false);
  return (
    <FieldGrid columns={2} className="mt-4 gap-y-5">
      <Field label={copy.howOftenLabel}>
        <select
          name="repeatIntervalWeeks"
          defaultValue="0"
          disabled={disabled}
          onChange={(event) => setRepeats(event.currentTarget.value !== "0")}
          className={controlClass}
        >
          <option value="0">{copy.doesntRepeat}</option>
          <option value="1">{copy.everyWeek}</option>
          <option value="2">{copy.every2Weeks}</option>
          <option value="4">{copy.every4Weeks}</option>
        </select>
      </Field>
      <Field label={copy.numberOfTripsLabel} description={copy.numberOfTripsDescription}>
        <input
          name="repeatCount"
          type="number"
          min={minOccurrences}
          max={maxOccurrences}
          // Disabled rather than hidden: the field keeps its place, so
          // choosing a cadence doesn't reflow the fieldset out from under the
          // pointer that just chose it. A disabled input submits nothing,
          // which is exactly right for a trip that doesn't repeat.
          disabled={disabled || !repeats}
          required={!disabled && repeats}
          placeholder={copy.numberOfTripsPlaceholder}
          className={`${controlClass} tabular-nums disabled:cursor-not-allowed disabled:opacity-60`}
        />
      </Field>
    </FieldGrid>
  );
}
