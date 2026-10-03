"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { SearchField } from "@/components/ui/form";
import { QueryForm } from "@/components/ui/QueryForm";

/**
 * **Today's arrival lookup**: "which boat is this diver on?", for the staffer
 * at the desk with somebody in front of them and no idea which departure they
 * booked. Each departure's own counter is its Check-in tab; this is the one
 * question none of those tabs can answer alone.
 */
export function ArrivalSearch({
  query,
  copy,
}: {
  query: string;
  copy: { label: string; placeholder: string };
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const clearSearchTimer = useCallback(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = null;
  }, []);

  useEffect(() => {
    setHydrated(true);
    return () => {
      clearSearchTimer();
    };
  }, [clearSearchTimer]);

  /**
   * Apply after a short pause, so a typed no-match never leaves stale results
   * on screen. The delay is long enough for a scanner to finish its barcode,
   * while ordinary typing still feels immediate; pressing Enter (which is what
   * a scanner sends after the code) still submits immediately through the real
   * form.
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

  // A router navigation, not a native GET submit — see `QueryForm`: a full
  // document reload put the staffer back at the top of the page every time.
  return (
    <QueryForm ref={formRef} onSubmitCapture={clearSearchTimer}>
      <SearchField
        id="arrival-search"
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
