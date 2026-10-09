"use client";

import { useId, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { ChoiceRow, controlClass, Field } from "@/components/ui/form";
import { isOneCoreSet } from "@/lib/counter-rentals";
import type { GearItemKind } from "@/lib/gear";
import {
  CONFIRM_FIELD_PREFIX,
  PRICE_FIELD_PREFIX,
  SET_PRICE_FIELD,
  UNIT_FIELD,
} from "../../rental-form";

export type PickerUnit = {
  id: string;
  kind: GearItemKind;
  label: string;
  size: string | null;
  /** Service words already in the staffer's language (overdue, concern, due soon). */
  care: string[];
  /** Why this unit cannot go to this person, worded; null when it can. */
  blocked: string | null;
  /** A flagged soft-goods unit: lent only with its own "lend anyway" tick. */
  confirmLabel: string | null;
  price: string;
  priceAria: string;
};

/** One line of words for a unit: what it is, its size, and anything wrong with it. */
function unitWords(unit: PickerUnit): string {
  return [unit.label, unit.size, ...unit.care, unit.blocked].filter(Boolean).join(" · ");
}

/**
 * **Which units go** — one menu per kind, and the list of what is going.
 *
 * A counter rental is a set more often than not: a mask, fins, a BCD, a
 * regulator, each in the person's size. So the free units sit in one native
 * menu per kind (a phone draws its own wheel), and a pick moves into the
 * "going out" list below with its price and a Remove — rather than every unit
 * on the wall drawn as its own row, which ran to dozens on a real fleet.
 * Blocked units stay in their menu, greyed with the reason, so nobody wonders
 * where the regulators went.
 *
 * The rules are decided on the server and arrive as words (`blocked`,
 * `confirmLabel`); this component only draws them and keeps the one thing
 * that depends on the picks: **the set price**. When the picks are exactly one
 * of each core kind and the shop prices a set, one set box opens prefilled
 * with set price × days and the set's own boxes step aside (disabled, so they
 * do not post). The action re-checks the set against what it wrote before it
 * bills it. A pick the new dates no longer offer drops out of the list.
 */
export function CounterUnitPicker({
  legend,
  groups,
  withPrices,
  step,
  coreKinds,
  setPrice,
  setLabel,
  choose,
  pickedHeading,
  removeAria,
}: {
  /** The group's accessible name; the card around it shows the same words as its title. */
  legend: string;
  groups: { kind: GearItemKind; kindLabel: string; units: PickerUnit[] }[];
  withPrices: boolean;
  step: string;
  coreKinds: GearItemKind[];
  /** The set price for these days, in major units, or null when the shop has none. */
  setPrice: string | null;
  setLabel: string;
  /** The empty first entry of each kind's menu. */
  choose: string;
  pickedHeading: string;
  /** Each Remove's accessible name, keyed by unit id. */
  removeAria: Record<string, string>;
}) {
  const headingId = useId();
  const [pickedIds, setPickedIds] = useState<readonly string[]>([]);
  const byId = new Map(groups.flatMap((group) => group.units.map((unit) => [unit.id, unit])));
  const picked = pickedIds.flatMap((id) => byId.get(id) ?? []);
  const asSet =
    withPrices &&
    setPrice !== null &&
    isOneCoreSet(
      coreKinds,
      picked.map((unit) => unit.kind),
    );

  return (
    <fieldset aria-label={legend} className="flex min-w-0 flex-col gap-6">
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        {groups.map((group) => {
          const left = group.units.filter((unit) => !pickedIds.includes(unit.id));
          return (
            <Field key={group.kind} label={group.kindLabel}>
              <select
                value=""
                onChange={(event) => {
                  const id = event.currentTarget.value;
                  if (id) setPickedIds((previous) => [...previous, id]);
                }}
                className={controlClass}
              >
                <option value="">{choose}</option>
                {left.map((unit) => (
                  <option key={unit.id} value={unit.id} disabled={unit.blocked !== null}>
                    {unitWords(unit)}
                  </option>
                ))}
              </select>
            </Field>
          );
        })}
      </div>

      {picked.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p id={headingId} className="text-sm font-medium">
            {pickedHeading}
          </p>
          <ul
            aria-labelledby={headingId}
            className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface"
          >
            {picked.map((unit) => {
              const inSet = asSet && coreKinds.includes(unit.kind);
              return (
                <li key={unit.id} className="flex flex-col gap-1 px-4 py-2">
                  <input type="hidden" name={UNIT_FIELD} value={unit.id} />
                  <div className="flex min-h-11 items-center gap-3">
                    <p className="min-w-0 flex-1 text-sm">
                      <span className="font-medium">{unit.label}</span>
                      {unit.size ? <span className="text-muted"> · {unit.size}</span> : null}
                      {unit.care.length > 0 ? (
                        <span className="text-warning-strong"> · {unit.care.join(" · ")}</span>
                      ) : null}
                    </p>
                    {withPrices ? (
                      <input
                        type="number"
                        name={`${PRICE_FIELD_PREFIX}${unit.id}`}
                        min={0}
                        step={step}
                        defaultValue={unit.price}
                        disabled={inSet}
                        aria-label={unit.priceAria}
                        className={`${controlClass} w-28 shrink-0`}
                      />
                    ) : null}
                    <button
                      type="button"
                      aria-label={removeAria[unit.id]}
                      onClick={() =>
                        setPickedIds((previous) => previous.filter((id) => id !== unit.id))
                      }
                      className={buttonClass({ variant: "ghost", size: "icon" })}
                    >
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        className="size-4"
                      >
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  </div>
                  {unit.confirmLabel ? (
                    <ChoiceRow
                      type="checkbox"
                      name={`${CONFIRM_FIELD_PREFIX}${unit.id}`}
                      className="text-sm"
                    >
                      {unit.confirmLabel}
                    </ChoiceRow>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {asSet && setPrice !== null ? (
        <Field label={setLabel} className="max-w-56">
          <input
            type="number"
            name={SET_PRICE_FIELD}
            min={0}
            step={step}
            defaultValue={setPrice}
            className={controlClass}
          />
        </Field>
      ) : null}
    </fieldset>
  );
}
