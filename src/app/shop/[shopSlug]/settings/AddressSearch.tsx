"use client";

import { useId, useRef, useState, useTransition } from "react";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import {
  isLookupWorthy,
  MAX_ADDRESS_QUERY_LENGTH,
  type PlaceSuggestion,
  type ShopAddressFields,
} from "@/lib/address-lookup";
import { saveAddressAction, suggestAddressAction } from "./actions";

/**
 * Every word this component renders, resolved server-side. Staff Client
 * Components take their copy as props — `staffTranslator` is server-only
 * (AGENTS.md).
 */
export type AddressSearchCopy = {
  searchLabel: string;
  searchPlaceholder: string;
  searching: string;
  saving: string;
  noMatches: string;
  lookupFailed: string;
  /** The hour's billed-request budget is spent — temporary, not broken. */
  lookupResting: string;
  /** No geocoder credentials: the one honest thing the card can say. */
  notConfigured: string;
  suggestionsLabel: string;
  /** Heading over the address currently saved. */
  currentLabel: string;
  /** Stated in place of the address when the shop has none. */
  noneSet: string;
  removeLabel: string;
  removing: string;
};

/**
 * How long to wait after the last keystroke before spending a billed request.
 *
 * 400ms, not the 250 this shipped with. Every fire is a *billed* Amazon
 * Location request against an hourly budget, and at 250ms any typist slower
 * than four characters a second spends one per keystroke — so composing one
 * long street address could cost thirty requests, and a couple of attempts
 * could walk through a good share of the hour. The budget running out is
 * indistinguishable, from the box, from the geocoder being down; both used to
 * read as "not available right now", which is how this was reported as simply
 * not working (2026-08-06 review). 400ms sits under the ~500ms where a
 * type-ahead starts to feel unresponsive, and roughly halves the spend.
 */
const DEBOUNCE_MS = 400;

const EMPTY_ADDRESS: ShopAddressFields = {
  addressStreet: "",
  addressLocality: "",
  addressRegion: "",
  addressPostalCode: "",
  addressCountry: "",
};

function isSet(address: ShopAddressFields): boolean {
  const { latitude, longitude, ...textFields } = address;
  return Object.values(textFields).some((value) => value.length > 0);
}

/** The stored address as a person reads it: street, then everything else. */
function addressLines(address: ShopAddressFields): string[] {
  const rest = [
    [address.addressLocality, address.addressRegion].filter(Boolean).join(", "),
    address.addressPostalCode,
    address.addressCountry,
  ]
    .filter(Boolean)
    .join(" ");
  return [address.addressStreet, rest].filter(Boolean);
}

function toFormData(address: ShopAddressFields): FormData {
  const form = new FormData();
  for (const [field, value] of Object.entries(address)) {
    if (value !== null && value !== undefined) {
      form.set(field, String(value));
    }
  }
  return form;
}

/**
 * The shop's address: one search box, and the address it found.
 *
 * This was five free-text boxes with a lookup bolted on top, and it carried
 * every problem a five-box address form has — a shop inventing its own spelling
 * of its own town, the postcode in the region box, `USA` where the column wants
 * `US` — plus a Save button between the shop and the thing it had already
 * chosen. All of it is gone. The boxes are not editable-and-optional, they are
 * absent; **picking a suggestion is the save**, because a shop that has just
 * clicked its own storefront out of a list has already expressed the whole of
 * its intent and a second confirmation only adds a way to lose it.
 *
 * That makes the search box the only way in, which is what makes the *quality*
 * of the search a correctness matter rather than a convenience: a shop
 * searches for itself by **name** far more readily than it recites its own
 * street address, so the lookup answers businesses, not only streets (see
 * `src/lib/address-lookup-aws.ts`).
 *
 * A pick **replaces** the whole address rather than merging into it
 * (`toShopAddressFields` returns every field, empty ones included). Merging
 * would leave a shop holding half of one address and half of another, which is
 * worse than either. Getting it wrong is one more search away, and clearing it
 * outright is the Remove control — with the boxes gone, that button is the only
 * way back to no address at all, so it is not optional garnish.
 *
 * `enabled` is false when the deployment has no geocoder credentials, which is
 * the ordinary local and self-hosted case. There is nothing to type into, so
 * the card says that in a sentence rather than rendering a box that answers
 * nothing — and the address the shop already has still reads back, because
 * being unable to *change* it is no reason to hide it.
 */
export function AddressSearch({
  initial,
  enabled,
  copy,
}: {
  initial: ShopAddressFields;
  enabled: boolean;
  copy: AddressSearchCopy;
}) {
  // The saved address, held locally so the picked one is on screen during the
  // round-trip. The action redirects, so the server's answer lands as a fresh
  // render rather than as a merge into this.
  const [address, setAddress] = useState(initial);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [status, setStatus] = useState<"idle" | "none" | "failed" | "resting">("idle");
  const [active, setActive] = useState(-1);
  const [isPending, startTransition] = useTransition();
  const [saving, setSaving] = useState<"none" | "picking" | "removing">("none");
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;
  // Guards against an out-of-order response overwriting a newer one: only the
  // most recent request may set state.
  const requestSeq = useRef(0);
  // The last query actually sent. Typing a character and deleting it, or
  // pausing twice on the same text, would otherwise spend a second billed
  // request to be told the same thing.
  const lastSent = useRef<string | null>(null);

  function runLookup(value: string) {
    const seq = ++requestSeq.current;
    if (!isLookupWorthy(value)) {
      setSuggestions([]);
      setStatus("idle");
      return;
    }
    // Same text as last time buys nothing but another billed request.
    if (value.trim() === lastSent.current) return;
    lastSent.current = value.trim();
    startTransition(async () => {
      const result = await suggestAddressAction(value);
      if (seq !== requestSeq.current) return;
      if (result.status === "ok") {
        setSuggestions(result.suggestions);
        setStatus(result.suggestions.length === 0 ? "none" : "idle");
      } else if (result.status === "rate_limited") {
        // Temporary and self-healing, so it gets its own sentence — reported
        // as "failed" it read as permanent breakage, and the staffer stopped
        // trying rather than waiting.
        setSuggestions([]);
        setStatus("resting");
        // Nothing was learned about this query, so let it be asked again.
        lastSent.current = null;
      } else if (result.status === "failed" || result.status === "not_configured") {
        // Both read the same to a staffer mid-errand: the lookup is not going
        // to help right now, and nothing they had is lost.
        setSuggestions([]);
        setStatus("failed");
        lastSent.current = null;
      } else {
        setSuggestions([]);
        setStatus("idle");
      }
      setActive(-1);
    });
  }

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onQueryChange(value: string) {
    setQuery(value);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => runLookup(value), DEBOUNCE_MS);
  }

  /**
   * A pick is the save. The action re-checks the session and the settings gate
   * server-side and then redirects, so the page comes back with its notice and
   * this component is replaced by one built from the stored row — the local
   * state below only carries the address across that round-trip.
   */
  function commit(next: ShopAddressFields, kind: "picking" | "removing") {
    setAddress(next);
    setQuery("");
    setSuggestions([]);
    setStatus("idle");
    setActive(-1);
    // Cancel a debounce still in flight: a lookup landing after the save would
    // reopen the list under an address that is already stored.
    if (debounce.current) clearTimeout(debounce.current);
    requestSeq.current += 1;
    lastSent.current = null;
    setSaving(kind);
    startTransition(async () => {
      await saveAddressAction(toFormData(next));
      setSaving("none");
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (suggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (index + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (index > 0 ? index - 1 : suggestions.length - 1));
    } else if (event.key === "Enter" && active >= 0) {
      // Only when a row is highlighted — otherwise Enter belongs to the page.
      event.preventDefault();
      commit(suggestions[active].address, "picking");
    } else if (event.key === "Escape") {
      setSuggestions([]);
      setActive(-1);
    }
  }

  const lines = addressLines(address);
  const message =
    saving === "picking" || saving === "removing"
      ? copy.saving
      : isPending
        ? copy.searching
        : status === "none"
          ? copy.noMatches
          : status === "resting"
            ? copy.lookupResting
            : status === "failed"
              ? copy.lookupFailed
              : "";

  return (
    <div className="mt-4 grid gap-4">
      {enabled ? (
        <div>
          {/* `Field` subgrids its caption and control onto two rows of the grid
              above it, so it needs a `FieldGrid` and not a bare div. */}
          <FieldGrid>
            <Field label={copy.searchLabel}>
              <div className="relative">
                <input
                  type="text"
                  role="combobox"
                  aria-expanded={suggestions.length > 0}
                  aria-controls={listId}
                  aria-autocomplete="list"
                  aria-activedescendant={active >= 0 ? optionId(active) : undefined}
                  autoComplete="off"
                  maxLength={MAX_ADDRESS_QUERY_LENGTH}
                  value={query}
                  onChange={(event) => onQueryChange(event.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={copy.searchPlaceholder}
                  className={controlClass}
                />
                {suggestions.length > 0 ? (
                  // `listbox`/`option` rather than a bare list: the input above
                  // is a `combobox` whose `aria-controls` and
                  // `aria-activedescendant` both point in here, and a screen
                  // reader only announces "3 of 5" for rows that carry the role
                  // those attributes promise.
                  // A `div` of buttons, not a `ul` of `li`s: a listbox's
                  // children must all be `option`, and an intervening
                  // `listitem` is exactly the child axe refuses.
                  <div
                    id={listId}
                    role="listbox"
                    aria-label={copy.suggestionsLabel}
                    className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
                  >
                    {suggestions.map((suggestion, index) => (
                      <button
                        key={suggestion.id}
                        type="button"
                        role="option"
                        aria-selected={index === active}
                        id={optionId(index)}
                        // `onMouseDown` rather than `onClick`: the click would
                        // land after the input's blur, by which point a future
                        // blur-to-close would already have unmounted this row.
                        onMouseDown={(event) => {
                          event.preventDefault();
                          commit(suggestion.address, "picking");
                        }}
                        onMouseEnter={() => setActive(index)}
                        className={`block w-full px-3 py-2 text-left text-sm ${
                          index === active ? "bg-surface-sunken" : ""
                        }`}
                      >
                        {suggestion.label}
                        {suggestion.detail ? (
                          <span className="block text-xs text-muted">{suggestion.detail}</span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </Field>
          </FieldGrid>
          {/* One live region for every transient state, so a screen reader
              hears the outcome without the list stealing focus. */}
          <p aria-live="polite" className="mt-1 min-h-5 text-sm text-muted">
            {message}
          </p>
        </div>
      ) : (
        // Not an error and not a dead box: a deployment with no geocoder
        // credentials is the ordinary local and self-hosted case.
        <p className="text-sm text-muted">{copy.notConfigured}</p>
      )}

      <div>
        <h4 className="text-sm font-medium">{copy.currentLabel}</h4>
        {lines.length > 0 ? (
          <address className="mt-1 text-sm text-muted not-italic">
            {lines.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </address>
        ) : (
          <p className="mt-1 text-sm text-muted">{copy.noneSet}</p>
        )}
        {isSet(address) ? (
          <button
            type="button"
            onClick={() => commit(EMPTY_ADDRESS, "removing")}
            disabled={saving !== "none"}
            // `-ml-3` cancels the variant's own left padding so the label lines
            // up with the address above it rather than sitting indented from
            // it — a borderless button's box is invisible, so its padding reads
            // as a stray indent instead of as the control's edge.
            className={buttonClass({
              variant: "danger-ghost",
              size: "sm",
              className: "-ml-3 mt-1",
            })}
          >
            {saving === "removing" ? copy.removing : copy.removeLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
