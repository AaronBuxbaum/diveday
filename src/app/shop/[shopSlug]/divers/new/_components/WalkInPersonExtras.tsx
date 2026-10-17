"use client";

import { useId, useState } from "react";
import { choiceClass, controlClass, DateField } from "@/components/ui/form";
import { PARTICIPANT_TYPES, type ParticipantType } from "@/lib/participant-types";
import { walkInMemberField } from "@/lib/walk-in-party";

export type WalkInExtrasCopy = {
  /** "Coming as" */
  comingAs: string;
  /** "Diver", "Snorkeler", "Rider" */
  types: Record<ParticipantType, string>;
  /** "Under 18" */
  under18: string;
  /** "A parent or legal guardian signs the release with them." */
  under18Hint: string;
  /** "Date of birth" */
  dob: string;
  /** "Optional. It sets a junior diver's depth limit." */
  dobHint: string;
};

/**
 * **What one walk-in is coming as, and whether they are under 18** (review
 * fixes, dive-domain FIX 2 and 3): the first person and every party row carry
 * the same three answers. "Coming as" defaults to Diver; "Under 18" asks for a
 * date of birth beside it, because the counter is the one place somebody can
 * just ask, and the date is what sets a junior's depth limit and which
 * courses they may join. The date field is always in the form and shown only
 * once the box is ticked, so a refused form can put a typed date back.
 */
export function WalkInPersonExtras({
  row,
  typeField,
  copy,
  dobMax,
}: {
  row: number;
  /** The form field "Coming as" posts under: the first person's own `participantType`, or the row's. */
  typeField: string;
  copy: WalkInExtrasCopy;
  /** The latest plausible date of birth (`maxPlausibleBirthDate`). */
  dobMax: string;
}) {
  const [minor, setMinor] = useState(false);
  const dobId = useId();
  return (
    <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
      <label className="grid gap-1 text-sm">
        <span className="font-medium">{copy.comingAs}</span>
        <select name={typeField} defaultValue="diver" className={controlClass}>
          {PARTICIPANT_TYPES.map((type) => (
            <option key={type} value={type}>
              {copy.types[type]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          name={walkInMemberField(row, "minor")}
          value="true"
          onChange={(event) => setMinor(event.currentTarget.checked)}
          className={choiceClass}
        />
        <span>
          {copy.under18}
          <span className="block text-xs text-muted">{copy.under18Hint}</span>
        </span>
      </label>
      <div hidden={!minor} className="grid gap-1 text-sm sm:col-span-2">
        <label htmlFor={dobId} className="font-medium">
          {copy.dob}
        </label>
        <span id={`${dobId}-hint`} className="text-xs text-muted">
          {copy.dobHint}
        </span>
        <DateField
          id={dobId}
          aria-describedby={`${dobId}-hint`}
          name={walkInMemberField(row, "dob")}
          max={dobMax}
        />
      </div>
    </div>
  );
}
