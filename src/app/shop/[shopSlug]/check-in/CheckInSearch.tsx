"use client";

import { useEffect, useRef } from "react";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/form";
import { QueryForm } from "@/components/ui/QueryForm";

export function CheckInSearch({
  query,
  copy,
}: {
  query: string;
  copy: { label: string; hint: string; placeholder: string; submit: string };
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // A router navigation, not a native GET submit — see `QueryForm`: the
  // counter searches with a boat waiting, and a full document reload put the
  // staffer back at the top of the page every time.
  return (
    <QueryForm className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <label className="min-w-0 flex-1 text-sm font-medium" htmlFor="check-in-search">
        {copy.label}
        <span className="mt-1 block text-xs font-normal text-muted">{copy.hint}</span>
        <input
          ref={inputRef}
          id="check-in-search"
          name="q"
          type="search"
          inputMode="search"
          defaultValue={query}
          placeholder={copy.placeholder}
          className={`${controlClass} mt-2`}
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
