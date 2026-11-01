"use client";

import { useRef, useState, useTransition } from "react";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/form";
import type { AssignGearUnitResult } from "../actions";

/** One unit a diver could take, already filtered to what is free for the window. */
export interface RentalUnitOption {
  id: string;
  label: string;
}

/**
 * One labelled band of the list — "Exactly what they asked for" and the rest
 * — rendered as an `<optgroup>`. A group with no options is dropped by the
 * caller, so a heading never stands over nothing.
 */
export interface RentalUnitGroup {
  key: string;
  label: string;
  options: RentalUnitOption[];
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
  /** Said when a hand-picked life-support unit needs care (`needs_care_confirm`). */
  needsCareConfirm: string;
  /** The one control that assigns that unit all the same. */
  assignAnyway: string;
}

/**
 * Commits each pick immediately. Availability is authoritative only after the
 * write; on refusal, restore the last successful assignment and show the reason
 * beside the control. Advance `previous` only on success so consecutive
 * refusals cannot point at a unit this diver never held. A care-flagged
 * life-support unit requires explicit "Assign anyway" confirmation.
 */
export function RentalUnitPicker({
  id,
  tripId,
  bookingId,
  groups,
  defaultValue,
  assign,
  copy,
}: {
  id: string;
  tripId: string;
  bookingId: string;
  /** The candidate units, already banded by size match. Worst case one band. */
  groups: RentalUnitGroup[];
  /** Preselected only for an exact size match; otherwise the placeholder. */
  defaultValue: string;
  assign: (input: {
    tripId: string;
    bookingId: string;
    gearItemId: string;
    assignAnyway?: boolean;
  }) => Promise<AssignGearUnitResult>;
  copy: RentalUnitPickerCopy;
}) {
  const [value, setValue] = useState(defaultValue);
  const [refusal, setRefusal] = useState<string | null>(null);
  // The life-support unit waiting on "Assign anyway", if one is.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const previous = useRef(defaultValue);

  function pick(next: string, assignAnyway = false) {
    if (!next || next === previous.current) return;
    setValue(next);
    setRefusal(null);
    setConfirming(null);
    startTransition(async () => {
      const result = await assign(
        assignAnyway
          ? { tripId, bookingId, gearItemId: next, assignAnyway }
          : { tripId, bookingId, gearItemId: next },
      );
      if (result.ok) {
        previous.current = next;
        return;
      }
      // Back to what it held, so the row never claims a reservation the
      // database refused.
      setValue(previous.current);
      // A hand-picked BCD, regulator or computer that needs care is asked
      // about rather than refused: the dock decides, in so many words
      // (dive-domain review of issue #2215).
      if (result.reason === "needs_care_confirm") {
        setRefusal(copy.needsCareConfirm);
        setConfirming(next);
        return;
      }
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
        {/* Separate size-match options from other available units in the native picker. */}
        {groups.map((group) => (
          <optgroup key={group.key} label={group.label}>
            {group.options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </optgroup>
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
      {confirming && !isPending ? (
        <button
          type="button"
          onClick={() => pick(confirming, true)}
          className={buttonClass({ variant: "secondary", size: "sm", className: "mt-2" })}
        >
          {copy.assignAnyway}
        </button>
      ) : null}
    </>
  );
}
