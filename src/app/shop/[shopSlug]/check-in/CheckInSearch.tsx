"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { SearchField } from "@/components/ui/form";
import { QueryForm } from "@/components/ui/QueryForm";

export function CheckInSearch({
  query,
  trip,
  copy,
}: {
  query: string;
  /**
   * The departure in focus, carried through every submit.
   *
   * `QueryForm` rebuilds the query string from this form's own fields, so a
   * param no field owns is dropped unless it is named here — and the focused
   * boat is exactly that: a `?trip=` the chips wrote, which the search box
   * knows nothing about. Without it, typing a name and clearing the box left
   * the counter pointed at whatever `selectFocusedDeparture` picks by default,
   * showing a different boat's head count to a staffer who never asked to
   * change boats (`./focus.ts`).
   */
  trip: string | undefined;
  copy: { label: string; placeholder: string };
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const clearSearchTimer = useCallback(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = null;
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
    setHydrated(true);
    return () => {
      clearSearchTimer();
    };
  }, [clearSearchTimer]);

  /**
   * Apply after a short pause so a typed no-match never leaves the full queue
   * on screen. The delay is long enough for a scanner to finish its barcode,
   * while ordinary typing still feels immediate; pressing Enter (which is what
   * a scanner sends after the code) still submits immediately through the
   * real form.
   */
  function applySearchOnInput(event: FormEvent<HTMLInputElement>) {
    clearSearchTimer();
    const value = event.currentTarget.value.trim();
    if (value === "") {
      if (query !== "") formRef.current?.requestSubmit();
      return;
    }
    if (value === query) return;
    searchTimerRef.current = setTimeout(() => {
      formRef.current?.requestSubmit();
    }, 300);
  }

  // A router navigation, not a native GET submit — see `QueryForm`: the
  // counter searches with a boat waiting, and a full document reload put the
  // staffer back at the top of the page every time.
  return (
    <QueryForm
      ref={formRef}
      keep={{ trip }}
      onSubmitCapture={clearSearchTimer}
      // **The page's own rhythm above it**, which this block used to contribute
      // nothing to: every other section on the counter opens on `mt-6`/`mt-8`,
      // so with no margin of its own the search sat 14px under the instrument —
      // close enough that the earned "Everyone's checked in" line read as a
      // caption on the search box rather than as the instrument's closing
      // statement.
      className="mt-8"
    >
      {/* The one search box (`SearchField`): its label is the accessible name
          and the placeholder ("Name, email, or booking ID") is the visible
          one. The "Search queue" button that stood beside it repeated what
          Enter — and the scanner's own carriage return — already does. */}
      <SearchField
        ref={inputRef}
        id="check-in-search"
        name="q"
        label={copy.label}
        defaultValue={query}
        placeholder={copy.placeholder}
        onInput={applySearchOnInput}
        // The e2e suite waits on this before relying on clear-to-apply — the
        // deterministic signal that the handler above is live.
        data-hydrated={hydrated ? "true" : undefined}
      />
    </QueryForm>
  );
}
