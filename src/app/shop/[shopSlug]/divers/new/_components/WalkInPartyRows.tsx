"use client";

import { useEffect, useRef, useState } from "react";
import { applyFormFields } from "@/components/apply-form-fields";
import { readKeptTyped } from "@/components/KeepTypedOnRefusal";
import { buttonClass } from "@/components/ui/button";
import { choiceClass, controlClass, legendClass } from "@/components/ui/form";
import { fill } from "@/i18n/fill";
import { WALK_IN_PARTY_FORM, WALK_IN_PARTY_MAX, walkInMemberField } from "@/lib/walk-in-party";

export type WalkInPartyCopy = {
  /** "Add another person" */
  add: string;
  /** "Person {n}" */
  person: string;
  /** "Full name" */
  name: string;
  /** "Under 18" */
  under18: string;
  /** "A parent or guardian signs the release with them." */
  under18Hint: string;
  /** "Remove" */
  remove: string;
  /** "Remove person {n}" */
  removeFor: string;
};

/**
 * **The rest of a walk-in family, on the same form** (fifth loop, item 9).
 * The form's own fields are the first person; each "Add another person" row
 * is one more, with the party form's "Under 18" tick, and the whole party is
 * seated together in one transaction (`seatParty`). A row with no name is
 * ignored, so an extra tap costs nothing.
 *
 * Rows are numbered by a counter that never reuses a number, so removing the
 * second of three never shifts a tick onto somebody else's name.
 */
export function WalkInPartyRows({
  copy,
  restore,
}: {
  copy: WalkInPartyCopy;
  /** The page came back with this form's refusal: rebuild the rows that were sent. */
  restore: boolean;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<number[]>([]);
  const next = useRef(1);
  const pending = useRef<Record<string, string> | null>(null);

  // Rebuild the rows a refused submit carried, then fill them once they exist.
  useEffect(() => {
    if (!restore) return;
    const kept = readKeptTyped(WALK_IN_PARTY_FORM);
    if (!kept) return;
    const numbers = Object.keys(kept)
      .map((name) => /^member-(\d+)-name$/.exec(name)?.[1])
      .filter((value): value is string => value !== undefined)
      .map(Number)
      .sort((a, b) => a - b)
      .slice(0, WALK_IN_PARTY_MAX - 1);
    if (numbers.length === 0) return;
    next.current = Math.max(...numbers) + 1;
    pending.current = kept;
    setRows(numbers);
  }, [restore]);

  useEffect(() => {
    const form = anchor.current?.closest("form");
    if (!form || !pending.current || rows.length === 0) return;
    applyFormFields(form, pending.current);
    pending.current = null;
  }, [rows]);

  const add = () => {
    const number = next.current;
    next.current += 1;
    setRows((current) => [...current, number]);
  };

  return (
    <div ref={anchor} className="col-span-full grid gap-4" data-testid="walk-in-party">
      {rows.map((number, index) => (
        <fieldset
          key={number}
          className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-[1fr_auto] sm:items-end"
        >
          <legend className={`${legendClass} text-sm font-medium`}>
            {fill(copy.person, { n: String(index + 2) })}
          </legend>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">{copy.name}</span>
            <input
              name={walkInMemberField(number, "name")}
              required
              maxLength={120}
              autoComplete="off"
              className={controlClass}
            />
          </label>
          <div className="flex items-center gap-4">
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                name={walkInMemberField(number, "minor")}
                value="true"
                className={choiceClass}
              />
              <span>
                {copy.under18}
                <span className="block text-xs text-muted">{copy.under18Hint}</span>
              </span>
            </label>
            <button
              type="button"
              onClick={() => setRows((current) => current.filter((row) => row !== number))}
              aria-label={fill(copy.removeFor, { n: String(index + 2) })}
              className={buttonClass({ variant: "ghost", size: "sm" })}
            >
              {copy.remove}
            </button>
          </div>
        </fieldset>
      ))}
      {rows.length < WALK_IN_PARTY_MAX - 1 ? (
        <div>
          <button
            type="button"
            onClick={add}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {copy.add}
          </button>
        </div>
      ) : null}
    </div>
  );
}
