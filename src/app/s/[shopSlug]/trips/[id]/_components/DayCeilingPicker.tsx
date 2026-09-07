"use client";

import { useEffect, useState } from "react";
import { controlClass, Field } from "@/components/ui/form";

/**
 * One rung a reader can claim, with the answer already written out for it.
 *
 * Every sentence is resolved on the server, in the reader's own language and
 * the shop's own depth unit, and shipped with the option. The browser picks
 * between prepared answers rather than composing one — which keeps the
 * agency ceilings, the metre/foot pairs and the ICU templates on the server
 * where the rest of the page's copy lives.
 */
export type DayCeilingOption = {
  /** A `certification_level` code, or `""` for the reader who holds no card yet. */
  value: string;
  label: string;
  /** What this day looks like against that rung: one line, or one per dive that is deeper. */
  lines: string[];
};

/** Where a reader's own answer is kept: this browser, and nowhere else. */
const STORED_LEVEL_KEY = "diveday.diver-level";

/**
 * **"Is this day inside what my card covers?", asked without an account.**
 *
 * The public departure page has no diver on file — an anonymous visitor is
 * exactly who it is written for — so the only honest way to answer that
 * question is to let the reader state the card themselves. What they pick is
 * held in this browser and nowhere else: no `people` row, no cookie the server
 * reads, no field that travels with the booking. The booking form asks its own
 * certification question a screen further down, where the answer is actually
 * being *given* to the shop (`DiveDeclarationFields`).
 *
 * **It informs and gates nothing** (H-08). A diver whose card stops shallower
 * than a site's maximum reads a sentence saying so and keeps every button they
 * had: the site's maximum is not the dive plan, and a guide who keeps a diver
 * at 15 m on a 30 m wall is running an ordinary correct day.
 *
 * The answer rides in `Field`'s `description`, so it is wired to the select as
 * `aria-describedby` and a screen reader hears the sentence the moment the
 * value changes rather than only on a re-read of the page.
 */
export function DayCeilingPicker({
  label,
  unsaidLabel,
  options,
}: {
  label: string;
  /** The standing "rather not say" answer, and the value the control ships in. */
  unsaidLabel: string;
  options: DayCeilingOption[];
}) {
  const [value, setValue] = useState("");
  // Read after mount rather than during render: the server has no browser
  // storage, so seeding state from it would hydrate a different control than
  // the one the server sent.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORED_LEVEL_KEY);
      if (stored !== null && options.some((option) => option.value === stored)) setValue(stored);
    } catch {
      // A browser refusing storage is not a reason to render nothing.
    }
  }, [options]);
  const chosen = value === "" ? null : options.find((option) => option.value === value);
  return (
    // Narrower than the column from `sm` up: a full-width control beside a
    // booking form reads as one of its fields, and nothing here is submitted.
    <div className="mt-4 sm:max-w-xs">
      <Field
        label={label}
        description={
          chosen ? (
            <span className="block space-y-1">
              {chosen.lines.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </span>
          ) : null
        }
      >
        <select
          className={controlClass}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            try {
              window.localStorage.setItem(STORED_LEVEL_KEY, event.target.value);
            } catch {
              // Same again: the page works, the answer just is not remembered.
            }
          }}
        >
          <option value="">{unsaidLabel}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}
