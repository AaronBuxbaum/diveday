"use client";

import { useId } from "react";
import { FIGURE_INLINE_CLASS } from "@/components/ui/typography";

/**
 * **A labelled range slider for a money amount**, the one control on `/pricing`.
 * A real `<input type="range">`, so the keyboard, a screen reader and a touch
 * drag all work with no script of ours; the value is read out beside the label.
 * `format` turns the number into the words shown (a dollar figure or a percent).
 */
export function MoneySlider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <label htmlFor={id} className="text-sm font-medium text-muted">
          {label}
        </label>
        <output htmlFor={id} className={FIGURE_INLINE_CLASS}>
          {format(value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-3 h-11 w-full cursor-pointer accent-primary"
      />
    </div>
  );
}
