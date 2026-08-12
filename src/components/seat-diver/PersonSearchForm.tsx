import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field } from "@/components/ui/form";
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
 */
export function PersonSearchForm({
  query,
  hiddenFields,
  label,
  placeholder,
  submitLabel,
  pendingLabel,
  className = "",
}: {
  /** The server's own query — see the `key` below for why it is not just a default. */
  query: string;
  /** Extra state a GET reload must carry, e.g. the walk-in's chosen `tripId`. */
  hiddenFields?: Record<string, string>;
  label: string;
  placeholder: string;
  submitLabel: string;
  pendingLabel: string;
  className?: string;
}) {
  return (
    <QueryForm className={`flex flex-wrap items-end gap-2 ${className}`}>
      {Object.entries(hiddenFields ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Field label={label} className="min-w-0 flex-1">
        <input
          type="search"
          name="diverq"
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
          maxLength={120}
          autoComplete="off"
          className={controlClass}
        />
      </Field>
      <SubmitButton pendingLabel={pendingLabel} className={buttonClass({ variant: "secondary" })}>
        {submitLabel}
      </SubmitButton>
    </QueryForm>
  );
}
