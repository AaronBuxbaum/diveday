"use client";

import { useId, useState } from "react";

/**
 * Preset-or-custom tip amount, kept mutually exclusive in the DOM itself —
 * not just in how the server happens to prefer one field over the other.
 * Before this was a client component, a preset radio and the "Other" text
 * input were two independent, uncontrolled fields: typing a custom amount
 * never un-checked whichever preset was still selected, so picking a preset
 * afterward left the custom field's stale value in place to submit instead
 * of the one now visibly selected. Controlled state here means exactly one
 * of "a preset is checked" or "the custom field holds a value" is ever true
 * at once, so what's charged always matches what's visibly chosen.
 */
export function TipAmountPicker({
  presets,
  defaultPreset,
  currencySymbol,
  legend,
  otherPlaceholder,
  otherAriaLabel,
}: {
  presets: number[];
  defaultPreset: number;
  /** The shop's own connected-account currency symbol (e.g. "$", "€") — never hardcoded (task 60). */
  currencySymbol: string;
  legend: string;
  otherPlaceholder: string;
  otherAriaLabel: string;
}) {
  const [selected, setSelected] = useState<number | "custom">(defaultPreset);
  const [custom, setCustom] = useState("");
  const customInputId = useId();

  return (
    <fieldset className="flex flex-wrap items-center gap-2">
      <legend className="sr-only">{legend}</legend>
      {presets.map((usd) => (
        <label
          key={usd}
          className="flex min-h-11 cursor-pointer items-center rounded-lg border border-border px-4 text-sm font-medium has-checked:border-primary has-checked:bg-primary-tint has-checked:text-primary"
        >
          <input
            type="radio"
            name="amount"
            value={usd}
            checked={selected === usd}
            onChange={() => {
              setSelected(usd);
              setCustom("");
            }}
            className="sr-only"
          />
          {currencySymbol}
          {usd}
        </label>
      ))}
      <label
        htmlFor={customInputId}
        className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm has-[:focus-within]:border-primary"
      >
        <span className="text-muted">{currencySymbol}</span>
        <input
          id={customInputId}
          type="number"
          name="customAmount"
          min={1}
          max={500}
          step={1}
          placeholder={otherPlaceholder}
          aria-label={otherAriaLabel}
          value={custom}
          onChange={(event) => {
            setCustom(event.target.value);
            setSelected("custom");
          }}
          className="w-16 bg-transparent text-sm focus:outline-none"
        />
      </label>
    </fieldset>
  );
}
