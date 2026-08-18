"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
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
   * while ordinary typing still feels immediate; pressing Enter or the button
   * continues to submit immediately through the real form.
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
      onSubmitCapture={clearSearchTimer}
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
    >
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
          onInput={applySearchOnInput}
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
