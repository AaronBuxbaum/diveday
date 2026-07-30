"use client";

import { useEffect, useRef } from "react";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/form";

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

  return (
    <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
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
    </form>
  );
}
