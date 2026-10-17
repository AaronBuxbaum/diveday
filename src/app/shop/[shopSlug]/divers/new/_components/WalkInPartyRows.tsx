"use client";

import { useEffect, useRef, useState } from "react";
import { applyFormFields } from "@/components/apply-form-fields";
import { readKeptTyped } from "@/components/KeepTypedOnRefusal";
import { buttonClass } from "@/components/ui/button";
import { controlClass, legendClass } from "@/components/ui/form";
import { fill } from "@/i18n/fill";
import { WALK_IN_PARTY_FORM, WALK_IN_PARTY_MAX, walkInMemberField } from "@/lib/walk-in-party";
import { type WalkInExtrasCopy, WalkInPersonExtras } from "./WalkInPersonExtras";

export type WalkInPartyCopy = {
  /** "Add another person" */
  add: string;
  /** "Person {n}" */
  person: string;
  /** "Full name" */
  name: string;
  /** Each row's "Coming as", "Under 18" and date of birth. */
  extras: WalkInExtrasCopy;
  /** "Remove" */
  remove: string;
  /** "Remove person {n}" */
  removeFor: string;
};

/**
 * **The rest of a walk-in family, on the same form** (fifth loop, item 9).
 * The form's own fields are the first person; each "Add another person" row
 * is one more, with what they are coming as and the party form's "Under 18"
 * tick (`WalkInPersonExtras`), and the whole party is seated together in one
 * transaction (`seatParty`). A row with no name is ignored, so an extra tap
 * costs nothing.
 *
 * Rows are numbered by a counter that never reuses a number, so removing the
 * second of three never shifts a tick onto somebody else's name.
 */
export function WalkInPartyRows({
  copy,
  restore,
  keptScope,
  dobMax,
}: {
  copy: WalkInPartyCopy;
  /** The latest plausible date of birth, for each row's date field. */
  dobMax: string;
  /** `keptTypedScope`: this shop and this staffer. */
  keptScope: string;
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
    const kept = readKeptTyped(WALK_IN_PARTY_FORM, keptScope);
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
  }, [restore, keptScope]);

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
        <fieldset key={number} className="grid gap-3 rounded-lg border border-border p-4">
          <legend className={`${legendClass} text-sm font-medium`}>
            {fill(copy.person, { n: String(index + 2) })}
          </legend>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
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
            <button
              type="button"
              onClick={() => setRows((current) => current.filter((row) => row !== number))}
              aria-label={fill(copy.removeFor, { n: String(index + 2) })}
              className={buttonClass({ variant: "ghost", size: "sm" })}
            >
              {copy.remove}
            </button>
          </div>
          <WalkInPersonExtras
            row={number}
            typeField={walkInMemberField(number, "type")}
            copy={copy.extras}
            dobMax={dobMax}
          />
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
