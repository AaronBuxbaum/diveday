"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, DateField, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { segmentClass, segmentedTrackClass } from "@/components/ui/segmented";

export type DayAddWords = {
  add: string;
  addTo: string;
  tabShift: string;
  tabDayOff: string;
  person: string;
  starts: string;
  ends: string;
  from: string;
  to: string;
  note: string;
  notePlaceholder: string;
  submitShift: string;
  submitDayOff: string;
  saving: string;
  needsOk: string | null;
};

/**
 * **The one way to add**, on the day it is for: a small "Add" that opens a shift form or a
 * days-off form under that day. The day is already chosen, so the form asks only what is left.
 * A manager also picks whose it is; everyone else adds to their own week.
 */
export function DayAdd({
  date,
  dayLabel,
  selfId,
  people,
  createShift,
  saveAway,
  words,
}: {
  date: string;
  dayLabel: string;
  selfId: string;
  /** Present for a manager, who may write for anyone. */
  people?: { id: string; name: string }[];
  createShift: (formData: FormData) => void;
  saveAway: (formData: FormData) => void;
  words: DayAddWords;
}) {
  const [mode, setMode] = useState<"shift" | "off">("shift");
  const person = people ? (
    <Field label={words.person}>
      <select name="personId" required defaultValue={selfId} className={controlClass}>
        {people.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
          </option>
        ))}
      </select>
    </Field>
  ) : (
    <input type="hidden" name="personId" value={selfId} />
  );
  return (
    <details className="group/add">
      <summary
        aria-label={words.addTo.replace("{day}", dayLabel)}
        className={`${buttonClass({ variant: "ghost", size: "md" })} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
      >
        {words.add}
      </summary>
      <div className="mt-3 flex flex-col gap-4 rounded-lg bg-surface-sunken p-3 sm:p-4">
        <div className={`${segmentedTrackClass} w-fit`}>
          {(["shift", "off"] as const).map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={mode === id}
              onClick={() => setMode(id)}
              className={`min-h-11 px-4 text-sm ${segmentClass({ selected: mode === id })}`}
            >
              {id === "shift" ? words.tabShift : words.tabDayOff}
            </button>
          ))}
        </div>
        {mode === "shift" ? (
          <FieldGrid as="form" action={createShift} columns={2}>
            {person}
            <input type="hidden" name="date" value={date} />
            <Field label={words.starts}>
              <DateField name="startTime" type="time" required defaultValue="07:00" />
            </Field>
            <Field label={words.ends}>
              <DateField name="endTime" type="time" required defaultValue="15:00" />
            </Field>
            <Field label={words.note}>
              <input
                name="note"
                maxLength={120}
                className={controlClass}
                placeholder={words.notePlaceholder}
              />
            </Field>
            <FieldActions>
              <SubmitButton pendingLabel={words.saving} className={buttonClass()}>
                {words.submitShift}
              </SubmitButton>
            </FieldActions>
          </FieldGrid>
        ) : (
          <FieldGrid as="form" action={saveAway} columns={2}>
            {person}
            <Field label={words.from}>
              <DateField name="startsOn" required defaultValue={date} />
            </Field>
            <Field label={words.to}>
              <DateField name="endsOn" required defaultValue={date} />
            </Field>
            <Field label={words.note}>
              <input
                name="note"
                maxLength={120}
                className={controlClass}
                placeholder={words.notePlaceholder}
              />
            </Field>
            {words.needsOk ? <p className="text-sm text-muted">{words.needsOk}</p> : null}
            <FieldActions>
              <SubmitButton pendingLabel={words.saving} className={buttonClass()}>
                {words.submitDayOff}
              </SubmitButton>
            </FieldActions>
          </FieldGrid>
        )}
      </div>
    </details>
  );
}
