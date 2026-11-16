"use client";

import { useState } from "react";
import { ChoiceFieldset, ChoiceRow } from "@/components/ui/form";
import { BLOWOUT_MAX_OFFERS } from "@/lib/blowout";

export type NonBoatPickerOption = { id: string; title: string; when: string; kind: string };
export type NonBoatPickerCopy = { title: string; legend: string; help: string; limit: string };

/** Nothing is selected by default. These are preference links, never a reservation. */
export function NonBoatAlternativesPicker({
  options,
  copy,
}: {
  options: readonly NonBoatPickerOption[];
  copy: NonBoatPickerCopy;
}) {
  const [selected, setSelected] = useState<readonly string[]>([]);
  if (!options.length) return null;
  return (
    <details className="mb-5">
      <summary className="flex min-h-11 cursor-pointer items-center text-base font-medium text-primary">
        {copy.title}
      </summary>
      <p className="mt-2 text-sm text-muted">{copy.help}</p>
      <ChoiceFieldset
        legend={copy.legend}
        className="mt-3"
        bodyClassName="mt-2 divide-y divide-border"
      >
        {options.map((option) => (
          <ChoiceRow
            key={option.id}
            type="checkbox"
            name="alternativeTripId"
            value={option.id}
            checked={selected.includes(option.id)}
            disabled={selected.length >= BLOWOUT_MAX_OFFERS && !selected.includes(option.id)}
            onChange={(event) =>
              setSelected(
                event.currentTarget.checked
                  ? [...selected, option.id]
                  : selected.filter((id) => id !== option.id),
              )
            }
          >
            <span className="block font-medium">{option.title}</span>
            <span className="block text-sm text-muted">
              {option.kind} · {option.when}
            </span>
          </ChoiceRow>
        ))}
      </ChoiceFieldset>
      {selected.length >= BLOWOUT_MAX_OFFERS ? (
        <p className="mt-2 text-sm text-muted">{copy.limit}</p>
      ) : null}
    </details>
  );
}
