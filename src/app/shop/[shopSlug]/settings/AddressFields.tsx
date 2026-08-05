"use client";

import { useId, useRef, useState, useTransition } from "react";
import { controlClass, Field } from "@/components/ui/form";
import {
  isLookupWorthy,
  MAX_ADDRESS_QUERY_LENGTH,
  type PlaceSuggestion,
  type ShopAddressFields,
} from "@/lib/address-lookup";
import { suggestAddressAction } from "./actions";

/**
 * Every word this component renders, resolved server-side. Staff Client
 * Components take their copy as props — `staffTranslator` is server-only
 * (AGENTS.md).
 */
export type AddressFieldsCopy = {
  searchLabel: string;
  searchHint: string;
  searchPlaceholder: string;
  searching: string;
  noMatches: string;
  lookupFailed: string;
  suggestionsLabel: string;
  streetLabel: string;
  streetPlaceholder: string;
  localityLabel: string;
  localityPlaceholder: string;
  regionLabel: string;
  regionPlaceholder: string;
  postalCodeLabel: string;
  postalCodePlaceholder: string;
  countryLabel: string;
  countryHint: string;
  countryPlaceholder: string;
};

/** How long to wait after the last keystroke before spending a billed request. */
const DEBOUNCE_MS = 250;

/**
 * The shop's address, with a place lookup over the top of it.
 *
 * The five boxes are still the record — they post, they can be edited by hand,
 * and they are what the shop keeps. What changes is that a shop no longer has
 * to *compose* its own address from memory: it types enough of one, picks the
 * real place, and the boxes fill in with a spelling, a region code, and an ISO
 * country that agree with each other. That address is published in the
 * structured data search engines read the shop's venue from, so the cost of a
 * typo there is not cosmetic.
 *
 * A pick **replaces** the whole address rather than merging into it
 * (`toShopAddressFields` returns every field, empty ones included). Merging
 * would leave a shop holding half of one address and half of another, which is
 * worse than either — and the boxes stay editable afterwards for the cases a
 * geocoder gets slightly wrong.
 *
 * `enabled` is false when the deployment has no geocoder credentials, which is
 * the ordinary local and self-hosted case. The search box simply isn't there,
 * and the card is exactly the five boxes it has always been — never a control
 * that looks broken.
 */
export function AddressFields({
  initial,
  enabled,
  copy,
}: {
  initial: ShopAddressFields;
  enabled: boolean;
  copy: AddressFieldsCopy;
}) {
  const [address, setAddress] = useState(initial);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [status, setStatus] = useState<"idle" | "none" | "failed">("idle");
  const [active, setActive] = useState(-1);
  const [isPending, startTransition] = useTransition();
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;
  // Guards against an out-of-order response overwriting a newer one: only the
  // most recent request may set state.
  const requestSeq = useRef(0);

  const set = (field: keyof ShopAddressFields) => (value: string) =>
    setAddress((current) => ({ ...current, [field]: value }));

  function runLookup(value: string) {
    const seq = ++requestSeq.current;
    if (!isLookupWorthy(value)) {
      setSuggestions([]);
      setStatus("idle");
      return;
    }
    startTransition(async () => {
      const result = await suggestAddressAction(value);
      if (seq !== requestSeq.current) return;
      if (result.status === "ok") {
        setSuggestions(result.suggestions);
        setStatus(result.suggestions.length === 0 ? "none" : "idle");
      } else if (result.status === "failed" || result.status === "not_configured") {
        // Both read the same to a staffer mid-errand: the lookup is not going
        // to help right now, and the boxes below still work.
        setSuggestions([]);
        setStatus("failed");
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

  function pick(suggestion: PlaceSuggestion) {
    setAddress(suggestion.address);
    setQuery("");
    setSuggestions([]);
    setStatus("idle");
    setActive(-1);
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
      // Only when a row is highlighted — otherwise Enter belongs to the form.
      event.preventDefault();
      pick(suggestions[active]);
    } else if (event.key === "Escape") {
      setSuggestions([]);
      setActive(-1);
    }
  }

  return (
    <>
      {enabled ? (
        <div className="sm:col-span-2">
          <Field label={copy.searchLabel} hint={copy.searchHint}>
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
                <ul
                  id={listId}
                  aria-label={copy.suggestionsLabel}
                  className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
                >
                  {suggestions.map((suggestion, index) => (
                    <li key={suggestion.id}>
                      <button
                        type="button"
                        id={optionId(index)}
                        // `onMouseDown` rather than `onClick`: the click would
                        // land after the input's blur, by which point a future
                        // blur-to-close would already have unmounted this row.
                        onMouseDown={(event) => {
                          event.preventDefault();
                          pick(suggestion);
                        }}
                        onMouseEnter={() => setActive(index)}
                        className={`block w-full px-3 py-2 text-left text-sm ${
                          index === active ? "bg-surface-sunken" : ""
                        }`}
                      >
                        {suggestion.label}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </Field>
          {/* One live region for all three transient states, so a screen
              reader hears the outcome without the list stealing focus. */}
          <p aria-live="polite" className="mt-1 min-h-5 text-sm text-muted">
            {isPending
              ? copy.searching
              : status === "none"
                ? copy.noMatches
                : status === "failed"
                  ? copy.lookupFailed
                  : ""}
          </p>
        </div>
      ) : null}
      <Field label={copy.streetLabel} className="sm:col-span-2">
        <input
          name="addressStreet"
          type="text"
          maxLength={200}
          autoComplete="street-address"
          value={address.addressStreet}
          onChange={(event) => set("addressStreet")(event.target.value)}
          placeholder={copy.streetPlaceholder}
          className={controlClass}
        />
      </Field>
      <Field label={copy.localityLabel}>
        <input
          name="addressLocality"
          type="text"
          maxLength={120}
          autoComplete="address-level2"
          value={address.addressLocality}
          onChange={(event) => set("addressLocality")(event.target.value)}
          placeholder={copy.localityPlaceholder}
          className={controlClass}
        />
      </Field>
      <Field label={copy.regionLabel}>
        <input
          name="addressRegion"
          type="text"
          maxLength={120}
          autoComplete="address-level1"
          value={address.addressRegion}
          onChange={(event) => set("addressRegion")(event.target.value)}
          placeholder={copy.regionPlaceholder}
          className={controlClass}
        />
      </Field>
      <Field label={copy.postalCodeLabel}>
        <input
          name="addressPostalCode"
          type="text"
          maxLength={20}
          autoComplete="postal-code"
          value={address.addressPostalCode}
          onChange={(event) => set("addressPostalCode")(event.target.value)}
          placeholder={copy.postalCodePlaceholder}
          className={controlClass}
        />
      </Field>
      <Field label={copy.countryLabel} hint={copy.countryHint}>
        <input
          name="addressCountry"
          type="text"
          maxLength={2}
          autoComplete="country"
          value={address.addressCountry}
          onChange={(event) => set("addressCountry")(event.target.value)}
          placeholder={copy.countryPlaceholder}
          className={controlClass}
        />
      </Field>
    </>
  );
}
