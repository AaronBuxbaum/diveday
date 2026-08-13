"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/form";
import { QueryForm } from "@/components/ui/QueryForm";

export function CheckInSearch({
  query,
  copy,
}: {
  query: string;
  copy: { label: string; placeholder: string; submit: string };
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
    setHydrated(true);
  }, []);

  /**
   * Emptying the box is a filter change, not a half-typed query — so it applies
   * itself. Nobody presses "Search" on an empty field, and until this fired the
   * counter sat on the last search's two rows while the staffer looked at a
   * blank box and a queue that was no longer the queue. Only on *empty*: every
   * other keystroke still waits for the submit, because searching per character
   * would re-render the queue under a scanner mid-barcode.
   */
  function applyWhenCleared(event: FormEvent<HTMLInputElement>) {
    if (event.currentTarget.value === "" && query !== "") formRef.current?.requestSubmit();
  }

  // A router navigation, not a native GET submit — see `QueryForm`: the
  // counter searches with a boat waiting, and a full document reload put the
  // staffer back at the top of the page every time.
  return (
    <QueryForm ref={formRef} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      {/* No hint line under the label. "A barcode scanner can type a booking
          ID here" said in prose what the label's own first word ("Scan") and
          the placeholder ("Name, email, or booking ID") already say between
          them — three pieces of text for one input. */}
      <label className="min-w-0 flex-1 text-sm font-medium" htmlFor="check-in-search">
        {copy.label}
        <input
          ref={inputRef}
          id="check-in-search"
          name="q"
          type="search"
          inputMode="search"
          defaultValue={query}
          placeholder={copy.placeholder}
          onInput={applyWhenCleared}
          // The e2e suite waits on this before relying on clear-to-apply — the
          // deterministic signal that the handler above is live.
          data-hydrated={hydrated ? "true" : undefined}
          className={`${controlClass} mt-1`}
        />
      </label>
      <button
        type="submit"
        className={buttonClass({ variant: "secondary", className: "shrink-0" })}
      >
        {copy.submit}
      </button>
    </QueryForm>
  );
}
