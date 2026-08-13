"use client";

import { useId, useMemo, useState } from "react";
import { StoredPhoto } from "@/components/StoredPhoto";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/form";
import { MAX_SITE_CREATURES } from "@/lib/dive-site-field-guide";

/**
 * One catalog species as the picker needs it, already in the reader's language.
 *
 * Resolved on the server by `marineLifeCatalogEntries` — a Client Component
 * cannot reach a translator, and these are the same words the briefing will
 * render, which is the point of showing them here at all.
 */
export type FieldGuideCatalogEntry = {
  slug: string;
  name: string;
  scientificName: string;
  kind: string;
  description: string;
  imageUrl: string;
};

export type FieldGuideEditorCopy = {
  legend: string;
  description: string;
  searchLabel: string;
  searchPlaceholder: string;
  add: string;
  empty: string;
  full: string;
  notFound: string;
  remove: string;
  /**
   * These three carry a literal `{name}` for the row they sit on. Templates
   * rather than functions because a Server Component may not hand a function to
   * a Client one — Next refuses the whole render. One token substituted below;
   * the sentences themselves still come from the bundle.
   */
  removeAriaLabel: string;
  moveUp: string;
  moveUpAriaLabel: string;
  moveDown: string;
  moveDownAriaLabel: string;
};

/**
 * The site's field guide: which faces a diver might meet here, in the order the
 * briefing shows them.
 *
 * **A selection, not a text form.** The shop chooses species and orders them;
 * the name, the category, the sentence and the "how to actually see one" tip
 * are DiveDay's, written once in every language and resolved for whoever is
 * reading (ADR 20260813-marine-life-is-diveday-copy). Until 2026-08-13 each row
 * here was four editable text boxes pre-filled from the catalog, which made the
 * words the shop's — and meant a Spanish-speaking shop that saved DiveDay's
 * starting text, as most would, published an English field guide inside a
 * Spanish briefing with no way to have both.
 *
 * So the card below is a **preview**, deliberately: it shows the staffer the
 * words a diver will read, in the staffer's own language, and there is nothing
 * to type. What a shop wants to say in its own voice about this particular reef
 * goes in the site's own fields — the dive plan, the fit note, the tips heading
 * — which are still entirely the shop's.
 *
 * A native `<datalist>` rather than a hand-built combobox: it is a real
 * autocomplete on every platform, it keyboard-navigates and announces itself
 * without a line of ARIA, and it degrades to a plain text box before hydration
 * — where "type a name and press Add" still works.
 */
export function FieldGuideEditor({
  initialSlugs,
  catalog,
  copy,
}: {
  initialSlugs: string[];
  catalog: FieldGuideCatalogEntry[];
  copy: FieldGuideEditorCopy;
}) {
  const [chosen, setChosen] = useState<string[]>(initialSlugs);
  const [query, setQuery] = useState("");
  const [missed, setMissed] = useState(false);
  const listId = useId();
  const full = chosen.length >= MAX_SITE_CREATURES;
  // Memoized on the catalog rather than rebuilt per render: this component
  // re-renders on every keystroke in the search box, and the catalog is 93
  // entries that never change during a session.
  const bySlug = useMemo(() => new Map(catalog.map((entry) => [entry.slug, entry])), [catalog]);

  const move = (index: number, delta: number) =>
    setChosen((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next;
    });

  /**
   * Add whatever is in the box, by common name or by Latin binomial.
   *
   * Anything the catalog does not carry is refused and said so, where it used
   * to become a blank card the staffer filled in by hand. That escape hatch is
   * gone with the text fields: a species DiveDay has no words for is a species
   * DiveDay cannot render in two languages, and half a translated guide reads
   * worse than one species fewer.
   */
  function addFromQuery() {
    const typed = query.trim();
    if (!typed || full) return;
    const match = catalog.find(
      (entry) =>
        entry.name.toLowerCase() === typed.toLowerCase() ||
        entry.scientificName.toLowerCase() === typed.toLowerCase(),
    );
    if (!match) {
      setMissed(true);
      return;
    }
    setMissed(false);
    setQuery("");
    if (chosen.includes(match.slug)) return;
    setChosen((current) => [...current, match.slug]);
  }

  return (
    <fieldset className="rounded-lg border border-border p-4">
      <legend className="px-1 text-sm font-medium">{copy.legend}</legend>
      <p className="mt-1 text-sm text-muted">{copy.description}</p>

      {/* The record the form posts. Always present, even when empty: clearing
          the last species has to be savable too. */}
      <input type="hidden" name="creatures" value={JSON.stringify(chosen)} />

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="min-w-56 flex-1 text-sm font-medium">
          {copy.searchLabel}
          <input
            list={listId}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setMissed(false);
            }}
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
            aria-invalid={missed || undefined}
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
      </div>
      {missed ? <p className="mt-2 text-sm text-danger">{copy.notFound}</p> : null}
      {full ? <p className="mt-2 text-sm text-muted">{copy.full}</p> : null}

      {chosen.length === 0 ? (
        <p className="mt-4 rounded-lg border border-border bg-surface-sunken p-3 text-sm text-muted">
          {copy.empty}
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {chosen.map((slug, index) => {
            const entry = bySlug.get(slug);
            if (!entry) return null;
            return (
              <li
                key={slug}
                className="flex gap-3 rounded-lg border border-border bg-surface-sunken p-3"
              >
                <StoredPhoto
                  src={entry.imageUrl}
                  alt=""
                  className="h-16 w-20 shrink-0 rounded-md"
                  sizes="80px"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[0.7rem] font-medium tracking-widest text-primary uppercase">
                    {entry.kind}
                  </p>
                  <p className="font-medium leading-tight">{entry.name}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{entry.description}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      aria-label={copy.moveUpAriaLabel.replace("{name}", entry.name)}
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      className={buttonClass({ variant: "secondary", size: "sm" })}
                    >
                      {copy.moveUp}
                    </button>
                    <button
                      type="button"
                      aria-label={copy.moveDownAriaLabel.replace("{name}", entry.name)}
                      onClick={() => move(index, 1)}
                      disabled={index === chosen.length - 1}
                      className={buttonClass({ variant: "secondary", size: "sm" })}
                    >
                      {copy.moveDown}
                    </button>
                    <button
                      type="button"
                      aria-label={copy.removeAriaLabel.replace("{name}", entry.name)}
                      onClick={() =>
                        setChosen((current) => current.filter((_, at) => at !== index))
                      }
                      className={buttonClass({ variant: "ghost", size: "sm" })}
                    >
                      {copy.remove}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}
