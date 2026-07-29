"use client";

import { useEffect, useRef } from "react";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/form";

export function CheckInSearch({ query }: { query: string }) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <label className="min-w-0 flex-1 text-sm font-medium" htmlFor="check-in-search">
        Scan or search diver
        <span className="mt-1 block text-xs font-normal text-muted">
          A barcode scanner can type a booking ID here.
        </span>
        <input
          ref={inputRef}
          id="check-in-search"
          name="q"
          type="search"
          inputMode="search"
          defaultValue={query}
          placeholder="Name, email, or booking ID"
          className={`${controlClass} mt-2`}
        />
      </label>
      <button
        type="submit"
        className={buttonClass({ variant: "secondary", className: "shrink-0" })}
      >
        Search queue
      </button>
    </form>
  );
}
