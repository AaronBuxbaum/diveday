"use client";

import { useEffect, useId, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button";

/** First schedule control: a URL preference, never a reservation. */
export function SchedulePartySize({
  value,
  copy,
  submit,
}: {
  value: number;
  copy: { partySize: string; fewerPeople: string; morePeople: string };
  submit: () => void;
}) {
  const labelId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [size, setSize] = useState(value);
  useEffect(() => {
    setSize(value);
    if (input.current) input.current.value = String(value);
  }, [value]);
  const change = (next: number) => {
    setSize(next);
    // Native form values must be ready before requestSubmit reads FormData.
    if (input.current) input.current.value = String(next);
    submit();
  };
  return (
    <fieldset aria-labelledby={labelId} className="mb-3 flex flex-wrap items-center gap-3">
      <legend id={labelId} className="float-start me-3 py-3 text-base font-medium">
        {copy.partySize}
      </legend>
      <button
        type="button"
        aria-label={copy.fewerPeople}
        disabled={size <= 1}
        onClick={() => change(size - 1)}
        className={buttonClass({ variant: "secondary", size: "icon" })}
      >
        <span aria-hidden="true">−</span>
      </button>
      <output
        aria-live="polite"
        className="min-w-8 text-center text-base font-semibold tabular-nums"
      >
        {size}
      </output>
      <button
        type="button"
        aria-label={copy.morePeople}
        disabled={size >= 8}
        onClick={() => change(size + 1)}
        className={buttonClass({ variant: "secondary", size: "icon" })}
      >
        <span aria-hidden="true">+</span>
      </button>
      <input ref={input} type="hidden" name="partySize" defaultValue={value} />
    </fieldset>
  );
}
