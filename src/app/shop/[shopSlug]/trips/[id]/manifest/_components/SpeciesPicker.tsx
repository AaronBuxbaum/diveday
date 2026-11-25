"use client";

import { useState } from "react";
import { DiveDayIcon } from "@/components/DiveDayIcon";
import { filterChipClass } from "@/components/ui/FilterChips";
import { controlClass, Field } from "@/components/ui/form";
import type { ExecutedDive } from "@/db/schema";
import type { ExecutedDiveLabels } from "./ExecutedDiveLog";
import { SPECIES_SHOWN_FIELD } from "./species-shown";

type Species = { slug: string | null; name: string | null };
type Option = { slug: string; name: string };

const MOST = 30;
const same = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

/**
 * **What the boat saw, picked by tapping** (owner, 2026-11-25). The animals
 * this site is known for are already on screen as chips: a tap says "seen", a
 * second tap takes it back. Anything else goes in the one search box, whose
 * matches are added the moment one is tapped; a name the catalog does not
 * carry is added as typed. There is no Add button, and nothing is typed for
 * the common case.
 */
export function SpeciesPicker({
  options,
  guide,
  row,
  labels,
}: {
  /** Every species DiveDay carries, the site's own first. */
  options: ReadonlyArray<Option>;
  /** The site's guide species: the chips offered before anything is searched. */
  guide: ReadonlyArray<Option>;
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
  const nameOf = (entry: Species) =>
    entry.name ?? options.find((option) => option.slug === entry.slug)?.name ?? entry.slug ?? "";
  const picked = (slug: string) => species.some((entry) => entry.slug === slug);
  const full = species.length >= MOST;

  function add(item: Species) {
    const taken = species.some(
      (entry) =>
        entry.slug === item.slug && (item.slug !== null || same(entry.name ?? "", item.name ?? "")),
    );
    if (!taken && !full) setSpecies([...species, item]);
    setInput("");
  }
  function toggle(slug: string) {
    if (picked(slug)) setSpecies(species.filter((entry) => entry.slug !== slug));
    else add({ slug, name: null });
  }
  /** The typed name: the catalog's species when it names one, else the words as typed. */
  function addTyped() {
    const name = input.trim();
    if (!name) return;
    const match = options.find((entry) => same(entry.name, name));
    add(match ? { slug: match.slug, name: null } : { slug: null, name });
  }

  const typed = input.trim();
  const matches = typed
    ? options
        .filter(
          (entry) =>
            !picked(entry.slug) &&
            entry.name.toLocaleLowerCase().includes(typed.toLocaleLowerCase()),
        )
        .slice(0, 6)
    : [];
  const typedIsNew = typed !== "" && !options.some((entry) => same(entry.name, typed));
  // The guide's chips, then whatever else was seen: one row of the same chip.
  const guideSlugs = new Set(guide.map((entry) => entry.slug));
  const others = species.filter((entry) => !entry.slug || !guideSlugs.has(entry.slug));

  return (
    <div className="sm:col-span-2" data-species-picker="">
      <Field
        group
        label={labels.observedSpecies}
        description={labels.observedSpeciesHint}
        hint={labels.optional}
      >
        <ul className="mb-3 flex flex-wrap gap-2 empty:hidden">
          {guide.map((entry) => (
            <li key={entry.slug}>
              <button
                type="button"
                aria-pressed={picked(entry.slug)}
                disabled={full && !picked(entry.slug)}
                className={`${filterChipClass(picked(entry.slug))} gap-1.5 disabled:opacity-60`}
                onClick={() => toggle(entry.slug)}
              >
                {picked(entry.slug) ? <DiveDayIcon name="check" className="size-4" /> : null}
                {entry.name}
              </button>
            </li>
          ))}
          {others.map((entry) => (
            <li key={entry.slug ?? entry.name}>
              <button
                type="button"
                aria-pressed
                className={`${filterChipClass(true)} gap-1.5`}
                onClick={() => setSpecies(species.filter((item) => item !== entry))}
              >
                <DiveDayIcon name="check" className="size-4" />
                {nameOf(entry)}
              </button>
            </li>
          ))}
        </ul>
        <input
          aria-label={labels.speciesPlaceholder}
          autoComplete="off"
          value={input}
          maxLength={80}
          disabled={full}
          placeholder={labels.speciesPlaceholder}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            addTyped();
          }}
          className={controlClass}
        />
        <ul data-species-matches="" className="empty:hidden">
          {matches.map((entry) => (
            <li key={entry.slug}>
              <button
                type="button"
                className="flex min-h-11 w-full items-center px-3 text-start text-sm hover:bg-surface-sunken"
                onClick={() => add({ slug: entry.slug, name: null })}
              >
                {entry.name}
              </button>
            </li>
          ))}
          {typedIsNew ? (
            <li>
              <button
                type="button"
                className="flex min-h-11 w-full items-center px-3 text-start text-sm font-medium text-primary hover:bg-surface-sunken"
                onClick={addTyped}
              >
                {labels.speciesAddTyped.replace("{name}", typed)}
              </button>
            </li>
          ) : null}
        </ul>
      </Field>
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
