"use client";

import { useId, useState } from "react";
import { StoredPhoto } from "@/components/StoredPhoto";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/form";
import { type DiveSiteCreature, MAX_SITE_CREATURES } from "@/lib/dive-site-field-guide";

/**
 * One catalog species as the picker needs it — DiveDay's own words, which
 * become the shop's the moment they are added.
 */
export type FieldGuideCatalogEntry = {
  slug: string;
  name: string;
  scientificName: string;
  kind: string;
  description: string;
  preparationTip: string;
  imageUrl: string;
};

export type FieldGuideEditorCopy = {
  legend: string;
  description: string;
  searchLabel: string;
  searchPlaceholder: string;
  add: string;
  addBlank: string;
  empty: string;
  full: string;
  notFound: string;
  nameLabel: string;
  kindLabel: string;
  kindPlaceholder: string;
  descriptionLabel: string;
  tipLabel: string;
  tipPlaceholder: string;
  remove: string;
  /**
   * These three carry a literal `{name}` for the row they sit on. Templates
   * rather than functions because the name is client state (it is being typed)
   * and a Server Component may not hand a function to a Client one — Next
   * refuses the whole render. One token substituted below; the sentences
   * themselves still come from the bundle.
   */
  removeAriaLabel: string;
  moveUp: string;
  moveUpAriaLabel: string;
  moveDown: string;
  moveDownAriaLabel: string;
};

const blank: DiveSiteCreature = {
  slug: "",
  name: "",
  kind: "",
  description: "",
  preparationTip: "",
  imageUrl: "",
};

/**
 * The site's field guide — the faces a diver might meet, in the order the
 * briefing shows them.
 *
 * These rows existed from the first release and had no way in: the seed wrote
 * them and nothing in the app could add, edit, reorder, or remove one. A shop
 * that imported a DiveDay site inherited DiveDay's species list forever, and a
 * shop that built its own site had no field guide at all.
 *
 * **Pick, then edit.** The box at the top is a `<datalist>` over DiveDay's
 * catalog (`src/db/marine-life-catalog.ts`) — type three letters of a fish and
 * take its name, category, description, tip and photo in one tap. Everything it
 * fills in is then an ordinary editable field, because the words on this site's
 * briefing are the shop's: its own name for the animal, its own tip about where
 * to look. Nothing is looked up again at render time, so a later catalog
 * correction never rewrites what a shop published.
 *
 * A native `<datalist>` rather than a hand-built combobox: it is a real
 * autocomplete on every platform, it keyboard-navigates and announces itself
 * without a line of ARIA, and it degrades to a plain text box before hydration
 * — where "type a name and press Add" still works.
 */
export function FieldGuideEditor({
  initialCreatures,
  catalog,
  copy,
}: {
  initialCreatures: DiveSiteCreature[];
  catalog: FieldGuideCatalogEntry[];
  copy: FieldGuideEditorCopy;
}) {
  const [creatures, setCreatures] = useState<DiveSiteCreature[]>(initialCreatures);
  const [query, setQuery] = useState("");
  const listId = useId();
  const full = creatures.length >= MAX_SITE_CREATURES;

  const update = (index: number, patch: Partial<DiveSiteCreature>) =>
    setCreatures((current) =>
      current.map((creature, at) => (at === index ? { ...creature, ...patch } : creature)),
    );

  const move = (index: number, delta: number) =>
    setCreatures((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next;
    });

  /**
   * Add whatever is in the box. A catalog match brings its whole card; anything
   * else becomes a species with that name and blanks to fill in — a shop that
   * dives somewhere DiveDay has never described is not stuck with an empty
   * guide.
   */
  function addFromQuery() {
    const typed = query.trim();
    if (!typed || full) return;
    const match = catalog.find(
      (entry) =>
        entry.name.toLowerCase() === typed.toLowerCase() ||
        entry.scientificName.toLowerCase() === typed.toLowerCase(),
    );
    setCreatures((current) => [
      ...current,
      match
        ? {
            slug: match.slug,
            name: match.name,
            kind: match.kind,
            description: match.description,
            preparationTip: match.preparationTip,
            imageUrl: match.imageUrl,
          }
        : { ...blank, name: typed },
    ]);
    setQuery("");
  }

  return (
    <fieldset className="rounded-lg border border-border p-4">
      <legend className="px-1 text-sm font-medium">{copy.legend}</legend>
      <p className="mt-1 text-sm text-muted">{copy.description}</p>

      {/* The record the form posts. Always present, even when empty: clearing
          the last species has to be savable too. */}
      <input type="hidden" name="creatures" value={JSON.stringify(creatures)} />

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="min-w-56 flex-1 text-sm font-medium">
          {copy.searchLabel}
          <input
            list={listId}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            // Enter inside a datalist box would otherwise submit the whole
            // briefing — a species picker is not a save button.
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              addFromQuery();
            }}
            maxLength={80}
            placeholder={copy.searchPlaceholder}
            disabled={full}
            className={`${controlClass} mt-1`}
          />
        </label>
        <datalist id={listId}>
          {catalog.map((entry) => (
            <option key={entry.slug} value={entry.name}>
              {entry.scientificName}
            </option>
          ))}
        </datalist>
        <button
          type="button"
          onClick={addFromQuery}
          disabled={full || query.trim() === ""}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {copy.add}
        </button>
        <button
          type="button"
          onClick={() => !full && setCreatures((current) => [...current, blank])}
          disabled={full}
          className={buttonClass({ variant: "ghost", size: "sm" })}
        >
          {copy.addBlank}
        </button>
      </div>
      {full ? <p className="mt-2 text-sm text-muted">{copy.full}</p> : null}

      {creatures.length === 0 ? (
        <p className="mt-4 rounded-lg border border-border bg-surface-sunken p-3 text-sm text-muted">
          {copy.empty}
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {creatures.map((creature, index) => (
            <li
              // Same as the landmark list: a species has no identity beyond its
              // position while its name is still being typed.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above
              key={index}
              className="rounded-lg border border-border bg-surface-sunken p-3"
            >
              <div className="flex gap-3">
                {creature.imageUrl ? (
                  <StoredPhoto
                    src={creature.imageUrl}
                    alt=""
                    className="h-16 w-20 shrink-0 rounded-md"
                    sizes="80px"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="flex h-16 w-20 shrink-0 items-center justify-center rounded-md bg-primary/10 text-xl font-semibold text-primary"
                  >
                    {creature.name.slice(0, 1) || "·"}
                  </span>
                )}
                <div className="flex min-w-0 flex-1 flex-wrap items-end gap-3">
                  <label className="min-w-40 flex-1 text-sm font-medium">
                    {copy.nameLabel}
                    <input
                      value={creature.name}
                      onChange={(event) => update(index, { name: event.target.value })}
                      maxLength={80}
                      className={`${controlClass} mt-1`}
                    />
                  </label>
                  <label className="min-w-32 text-sm font-medium">
                    {copy.kindLabel}
                    <input
                      value={creature.kind}
                      onChange={(event) => update(index, { kind: event.target.value })}
                      maxLength={40}
                      placeholder={copy.kindPlaceholder}
                      className={`${controlClass} mt-1`}
                    />
                  </label>
                </div>
              </div>
              <label className="mt-3 block text-sm font-medium">
                {copy.descriptionLabel}
                <textarea
                  value={creature.description}
                  onChange={(event) => update(index, { description: event.target.value })}
                  rows={2}
                  maxLength={240}
                  className={`${controlClass} mt-1`}
                />
              </label>
              <label className="mt-3 block text-sm font-medium">
                {copy.tipLabel}
                <textarea
                  value={creature.preparationTip}
                  onChange={(event) => update(index, { preparationTip: event.target.value })}
                  rows={2}
                  maxLength={240}
                  placeholder={copy.tipPlaceholder}
                  className={`${controlClass} mt-1`}
                />
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  aria-label={copy.moveUpAriaLabel.replace("{name}", creature.name)}
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  className={buttonClass({ variant: "secondary", size: "sm" })}
                >
                  {copy.moveUp}
                </button>
                <button
                  type="button"
                  aria-label={copy.moveDownAriaLabel.replace("{name}", creature.name)}
                  onClick={() => move(index, 1)}
                  disabled={index === creatures.length - 1}
                  className={buttonClass({ variant: "secondary", size: "sm" })}
                >
                  {copy.moveDown}
                </button>
                <button
                  type="button"
                  aria-label={copy.removeAriaLabel.replace("{name}", creature.name)}
                  onClick={() => setCreatures((current) => current.filter((_, at) => at !== index))}
                  className={buttonClass({ variant: "ghost", size: "sm" })}
                >
                  {copy.remove}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
