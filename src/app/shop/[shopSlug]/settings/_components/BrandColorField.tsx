"use client";

import { useState } from "react";
import { controlClass } from "@/components/ui/form";
import { DIVEDAY_BRAND_COLOR } from "@/lib/brand";

/**
 * The brand colour, as a picker and a hex field that agree (Harbor, ADR
 * 20260901-diveday-reimagined, decision 2). The hex field is the one the form
 * submits — `brandColor` — because a `<input type="color">` can never be blank,
 * and blank is how a shop says "keep DiveDay's teal". The picker is a hand for
 * the field, not a second source of truth. Words arrive as props: this is a
 * staff Client Component.
 */
export function BrandColorField({
  initial,
  pickerLabel,
  placeholder,
}: {
  initial: string | null;
  pickerLabel: string;
  placeholder: string;
}) {
  const [value, setValue] = useState(initial ?? "");
  const picked = /^#[0-9a-f]{6}$/i.test(value) ? value : DIVEDAY_BRAND_COLOR;
  return (
    <div className="flex items-center gap-3">
      <input
        type="color"
        aria-label={pickerLabel}
        value={picked}
        onChange={(event) => setValue(event.target.value)}
        className="size-11 shrink-0 cursor-pointer rounded-lg border border-border-strong bg-surface p-1"
      />
      <input
        name="brandColor"
        type="text"
        maxLength={7}
        pattern="#?[0-9a-fA-F]{6}"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        className={controlClass}
      />
    </div>
  );
}
