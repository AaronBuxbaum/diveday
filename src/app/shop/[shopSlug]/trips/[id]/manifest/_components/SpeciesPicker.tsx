"use client";

import { useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field } from "@/components/ui/form";
import type { ExecutedDive } from "@/db/schema";
import type { ExecutedDiveLabels } from "./ExecutedDiveLog";
import { SPECIES_SHOWN_FIELD } from "./species-shown";

type Species = { slug: string | null; name: string | null };

export function SpeciesPicker({
  diveNumber,
  options,
  row,
  labels,
}: {
  diveNumber: number;
  options: ReadonlyArray<{ slug: string; name: string }>;
  row?: ExecutedDive;
  labels: ExecutedDiveLabels;
}) {
  const [species, setSpecies] = useState<Species[]>(() => {
    const saved = row?.observedSpeciesEntries ?? [];
    return saved.length
      ? saved
      : row?.observedSpeciesSlug
        ? [{ slug: row.observedSpeciesSlug, name: null }]
        : [];
  });
  const [input, setInput] = useState("");
  function add() {
    const name = input.trim();
    if (!name || species.length >= 30) return;
    const match = options.find(
      (entry) => entry.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
    const item = match ? { slug: match.slug, name: null } : { slug: null, name };
    if (
      !species.some(
        (entry) =>
          entry.slug === item.slug &&
          entry.name?.toLocaleLowerCase() === item.name?.toLocaleLowerCase(),
      )
    )
      setSpecies([...species, item]);
    setInput("");
  }
  return (
    <div className="sm:col-span-2">
      <Field
        label={labels.observedSpecies}
        description={labels.observedSpeciesHint}
        hint={labels.optional}
      >
        <input
          list={`species-${diveNumber}`}
          value={input}
          maxLength={80}
          placeholder={labels.speciesPlaceholder}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          className={controlClass}
        />
      </Field>
      <datalist id={`species-${diveNumber}`}>
        {options.map((entry) => (
          <option key={entry.slug} value={entry.name} />
        ))}
      </datalist>
      <button
        type="button"
        className={buttonClass({ variant: "secondary", size: "sm", className: "mt-2" })}
        disabled={!input.trim() || species.length >= 30}
        onClick={add}
      >
        {labels.speciesAdd}
      </button>
      <ul className="mt-2 flex flex-wrap gap-2">
        {species.map((entry) => {
          const name =
            entry.name ??
            options.find((option) => option.slug === entry.slug)?.name ??
            entry.slug ??
            "";
          return (
            <li
              key={entry.slug ?? entry.name}
              className="flex items-center gap-2 rounded-full bg-surface-sunken px-3 py-1 text-sm"
            >
              {name}
              <button
                type="button"
                aria-label={`${labels.speciesRemove}: ${name}`}
                onClick={() => setSpecies(species.filter((item) => item !== entry))}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
      <input type="hidden" name={SPECIES_SHOWN_FIELD} value="1" />
      {species.map((entry) => (
        <input
          key={entry.slug ?? entry.name}
          type="hidden"
          name="observedSpeciesEntries"
          value={JSON.stringify(entry)}
        />
      ))}
    </div>
  );
}
