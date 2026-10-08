"use client";

import { type ChangeEvent, useState } from "react";
import { ChoiceFieldset, ChoicePill, ChoiceRow, controlClass, Field } from "@/components/ui/form";
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

/**
 * **Which units go** — the rent-out form's unit list, grouped by kind.
 *
 * The rules are decided on the server and arrive as words (`blocked`,
 * `confirmLabel`); this component only draws them and keeps the one thing
 * that depends on the staffer's ticks: **the set price**. When the picks are
 * exactly one of each core kind and the shop prices a set, one set box opens
 * prefilled with set price × days and the set's own boxes step aside
 * (disabled, so they do not post). The action re-checks the set against what
 * it wrote before it bills it.
 */
export function CounterUnitPicker({
  legend,
  groups,
  withPrices,
  step,
  coreKinds,
  setPrice,
  setLabel,
}: {
  legend: string;
  groups: { kind: GearItemKind; kindLabel: string; units: PickerUnit[] }[];
  withPrices: boolean;
  step: string;
  coreKinds: GearItemKind[];
  /** The set price for these days, in major units, or null when the shop has none. */
  setPrice: string | null;
  setLabel: string;
}) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const kindOf = new Map(
    groups.flatMap((group) => group.units.map((unit) => [unit.id, unit.kind])),
  );
  const pickedKinds = [...picked].flatMap((id) => kindOf.get(id) ?? []);
  const asSet = withPrices && setPrice !== null && isOneCoreSet(coreKinds, pickedKinds);
  const toggle = (id: string, on: boolean) =>
    setPicked((previous) => {
      const next = new Set(previous);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <ChoiceFieldset legend={legend} bodyClassName="flex flex-col gap-5">
      {groups.map((group) => (
        <div key={group.kind}>
          <p className="text-sm text-muted">{group.kindLabel}</p>
          <div className="mt-2 flex flex-col gap-2">
            {group.units.map((unit) => {
              const words = (
                <>
                  <span className="font-medium">{unit.label}</span>
                  {unit.size ? <span className="text-muted"> · {unit.size}</span> : null}
                  {unit.care.length > 0 ? (
                    <span className="text-warning-strong"> · {unit.care.join(" · ")}</span>
                  ) : null}
                  {unit.blocked ? <span className="text-danger"> · {unit.blocked}</span> : null}
                </>
              );
              const box = {
                type: "checkbox" as const,
                name: UNIT_FIELD,
                value: unit.id,
                disabled: unit.blocked !== null,
                onChange: (event: ChangeEvent<HTMLInputElement>) =>
                  toggle(unit.id, event.currentTarget.checked),
              };
              const inSet = asSet && picked.has(unit.id) && coreKinds.includes(unit.kind);
              return (
                <div key={unit.id} className="flex flex-col gap-1">
                  {withPrices ? (
                    <ChoicePill
                      {...box}
                      aside={
                        <input
                          type="number"
                          name={`${PRICE_FIELD_PREFIX}${unit.id}`}
                          min={0}
                          step={step}
                          defaultValue={unit.price}
                          disabled={unit.blocked !== null || inSet}
                          aria-label={unit.priceAria}
                          className={`${controlClass} w-28 shrink-0`}
                        />
                      }
                    >
                      {words}
                    </ChoicePill>
                  ) : (
                    <ChoiceRow {...box}>{words}</ChoiceRow>
                  )}
                  {unit.confirmLabel && picked.has(unit.id) ? (
                    <ChoiceRow
                      type="checkbox"
                      name={`${CONFIRM_FIELD_PREFIX}${unit.id}`}
                      className="ms-8 text-sm"
                    >
                      {unit.confirmLabel}
                    </ChoiceRow>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ))}
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
    </ChoiceFieldset>
  );
}
