import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { SearchField } from "@/components/ui/form";
import { QueryForm } from "@/components/ui/QueryForm";

/**
 * The one "find a returning diver" box, shared by every staff door that seats
 * one (the trip's Guests tab, the counter walk-in, the global Add-booking
 * step two).
 *
 * Server-fed search on purpose: a GET reload carries `diverq` and the list
 * re-renders from the server. No client state, so the picker stays
 * pixel-stable for visual regression — and the three doors cannot drift apart
 * on `maxLength`, autocomplete, or the button's variant, which is exactly what
 * had happened while each one kept its own copy of this form.
 *
 * The reload is a router navigation (`QueryForm`), not a native GET submit: a
 * staffer mid-list who searched used to be thrown back to the top of the page
 * by the document tearing down. The URL, the server render and the
 * pre-hydration native submit are all unchanged.
 *
 * Words arrive as props: this is shared UI under `src/components`, so it never
 * reads the staff bundle itself (AGENTS.md — staff copy is resolved
 * server-side by the page that renders it).
 *
 * **It wears `SearchField`, and has no Search button.** It was the one search
 * in the app still carrying a visible caption and a secondary submit beside
 * the band's own primary — three controls in one row, which on a 390px phone
 * wrapped the caption onto two lines and left the box about 130px wide
 * (issue #1230). Enter submits the GET form before and after hydration, which
 * is what the button was doing; the caption goes `sr-only` and the
 * placeholder carries the visible hint, exactly as every other staff search
 * box does. "Add diver" is then the one primary in the band, which is the
 * action-row rule this was quietly breaking.
 */
export function PersonSearchForm({
  query,
  queryName = "diverq",
  hiddenFields,
  label,
  placeholder,
  addDiverHref,
  addDiverLabel,
  className = "",
}: {
  /** The server's own query — see the `key` below for why it is not just a default. */
  query: string;
  /** The URL key for this search when a page has more than one picker. */
  queryName?: string;
  /** Extra state a GET reload must carry, e.g. the walk-in's chosen `tripId`. */
  hiddenFields?: Record<string, string>;
  /** The accessible name. Rendered `sr-only` — the placeholder is the visible hint. */
  label: string;
  placeholder: string;
  /** Optional link to add a new diver directly */
  addDiverHref?: string;
  addDiverLabel?: string;
  className?: string;
}) {
  return (
    <QueryForm className={`flex flex-wrap items-center gap-2 ${className}`}>
      {Object.entries(hiddenFields ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {/* The box takes the whole first row below `sm`: it shared a 358px row
          with a Search button and "Add diver" and had four characters of it
          ("Name, ema"). One button now, and the box still gets its own line on
          a phone. */}
      <SearchField
        id={`${queryName}-search`}
        name={queryName}
        label={label}
        // Keyed on the server's own query so the box can never disagree with
        // it. `defaultValue` applies at mount only, so without this the typed
        // text survives a navigation as client state the comment above
        // promises does not exist: seat a diver or trip a refusal — both
        // redirect to a URL with no `diverq` — and the server renders an
        // empty box while the DOM still shows the old search. Whichever the
        // screenshot caught made `trip-guests-refusal-level` flake between
        // runs on identical code. Re-keying remounts the input, so the value
        // is always the server's.
        key={query}
        defaultValue={query}
        placeholder={placeholder}
        className="min-w-0 flex-1 max-sm:basis-full"
      />
      {addDiverHref && addDiverLabel ? (
        <Link
          href={addDiverHref}
          className={buttonClass({ variant: "primary", className: "whitespace-nowrap" })}
        >
          {addDiverLabel}
        </Link>
      ) : null}
    </QueryForm>
  );
}
