"use client";

import { useRef, useState, useTransition } from "react";
import { controlClass } from "@/components/ui/form";
import type { AssignGearUnitResult } from "../actions";

/** One unit a diver could take, already filtered to what is free for the window. */
export interface RentalUnitOption {
  id: string;
  label: string;
}

export interface RentalUnitPickerCopy {
  /** The empty option, shown until a unit is picked. */
  pickUnit: string;
  /** Said on the row while the pick is in flight. */
  assigning: string;
  /** One sentence per refusal the write can answer with, keyed by its code. */
  refusals: Record<string, string>;
  /** The fallback, for a reason this build has no sentence for. */
  refusalFallback: string;
}

/**
 * **A rental pick that commits itself.**
 *
 * This row used to be a `<form>` with a `<select>` and a separate "Assign"
 * button beside it. A seeded departure renders twenty-one of them, so one boat
 * was 21 dropdowns, 21 confirming taps, and the word "Assign" printed twenty-one
 * times down a single column — at a counter, on the morning of a departure,
 * against a clock (issue #802). Principle 10 is direct about it: a value a
 * staffer corrects often is edited where it is displayed, not behind a button
 * that is really an "Edit" once per row; principle 9's cross-out test deletes
 * the twenty repeats of the word.
 *
 * **The refusal is why this needed a component rather than a one-line change.**
 * A reservation's double-booking guard is a Postgres exclusion constraint, so
 * availability cannot be pre-checked as truth — the answer only exists after
 * the write. When it comes back refused the select goes back to what it held,
 * and the row says why, next to the pick that failed rather than in a banner at
 * the top of a long page. `previous` is the revert target and is only advanced
 * on success, so two refusals in a row cannot leave it pointing at a unit this
 * diver never held.
 */
export function RentalUnitPicker({
  id,
  tripId,
  bookingId,
  options,
  defaultValue,
  assign,
  copy,
}: {
  id: string;
  tripId: string;
  bookingId: string;
  options: RentalUnitOption[];
  /** Preselected only for an exact size match; otherwise the placeholder. */
  defaultValue: string;
  assign: (input: {
    tripId: string;
    bookingId: string;
    gearItemId: string;
  }) => Promise<AssignGearUnitResult>;
  copy: RentalUnitPickerCopy;
}) {
  const [value, setValue] = useState(defaultValue);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const previous = useRef(defaultValue);

  function pick(next: string) {
    if (!next || next === previous.current) return;
    setValue(next);
    setRefusal(null);
    startTransition(async () => {
      const result = await assign({ tripId, bookingId, gearItemId: next });
      if (result.ok) {
        previous.current = next;
        return;
      }
      // Back to what it held, so the row never claims a reservation the
      // database refused.
      setValue(previous.current);
      setRefusal(copy.refusals[result.reason] ?? copy.refusalFallback);
    });
  }

  return (
    <>
      <select
        id={id}
        value={value}
        disabled={isPending}
        onChange={(event) => pick(event.target.value)}
        // `aria-describedby` only while there is something to describe: a
        // permanently-referenced empty node is a screen reader announcing a
        // blank after every pick.
        aria-describedby={refusal ? `${id}-refusal` : undefined}
        className={controlClass}
      >
        {value ? null : (
          <option value="" disabled>
            {copy.pickUnit}
          </option>
        )}
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      {isPending ? (
        <p className="mt-1 text-xs text-muted" aria-live="polite">
          {copy.assigning}
        </p>
      ) : null}
      {refusal ? (
        // `role="alert"` and on the row: the staffer's eyes are on the pick
        // they just made, and this is the one thing that changed.
        <p
          id={`${id}-refusal`}
          role="alert"
          className="mt-1 text-xs font-medium text-warning-strong"
        >
          {refusal}
        </p>
      ) : null}
    </>
  );
}
