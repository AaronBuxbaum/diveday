// i18n-exempt-file: every visible label arrives as an already-translated prop.
"use client";

import { useState } from "react";
import { controlClass, Field } from "@/components/ui/form";

/** One "rents from the shop" tick — the shop's catalog, not the diver's answer. */
export type RentalFitToggle = {
  /** The checkbox `name` the save action reads (`RENTABLE_ITEMS`). */
  name: string;
  label: string;
  defaultChecked: boolean;
};

/** One size box, and the ticks that make it worth asking for. */
export type RentalFitSize = {
  name: string;
  label: string;
  placeholder: string;
  defaultValue: string;
  /**
   * Checkbox names that put this size on the packing list. More than one for
   * fin & boot size, which rides along with a wetsuit as well as with fins.
   */
  requires: readonly string[];
};

/**
 * **The sizes a shop is actually going to pack, and nothing else.**
 *
 * The size boxes used to be gated on the shop's *catalog* alone, so a diver
 * who brings their own suit and rents only weights was still asked for a
 * wetsuit size — four boxes for one tick, on the form a front desk fills in
 * with somebody waiting. A size for gear this diver does not rent is a number
 * nobody will ever lay out.
 *
 * **Un-ticking never throws the answer away.** A hidden size keeps its value in
 * state and rides along in a hidden input, so the save still writes it and
 * re-ticking the box brings it straight back — the diver who skips a wetsuit in
 * August has not forgotten what size they take in January. That is also why the
 * value is controlled rather than left to the DOM: an unmounted uncontrolled
 * input loses what was typed into it, which is exactly the thing this must not
 * do.
 *
 * A client component because the question is "what is ticked *right now*",
 * which a server render cannot answer. Before hydration the form still posts
 * and the save still lands — only the hiding needs the browser.
 */
export function RentalFitFields({
  legend,
  toggles,
  sizes,
}: {
  legend: string;
  toggles: readonly RentalFitToggle[];
  sizes: readonly RentalFitSize[];
}) {
  const [rented, setRented] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(toggles.map((toggle) => [toggle.name, toggle.defaultChecked])),
  );
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(sizes.map((size) => [size.name, size.defaultValue])),
  );

  return (
    <>
      {toggles.length > 0 ? (
        <fieldset className="sm:col-span-2">
          <legend className="text-sm font-medium">{legend}</legend>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {toggles.map((toggle) => (
              <label
                key={toggle.name}
                className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 text-sm"
              >
                <input
                  name={toggle.name}
                  type="checkbox"
                  checked={rented[toggle.name] ?? false}
                  onChange={(event) =>
                    setRented((previous) => ({
                      ...previous,
                      [toggle.name]: event.target.checked,
                    }))
                  }
                  className="size-4 accent-primary"
                />
                {toggle.label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      {sizes.map((size) =>
        size.requires.some((name) => rented[name]) ? (
          <Field key={size.name} label={size.label}>
            <input
              name={size.name}
              value={values[size.name] ?? ""}
              onChange={(event) =>
                setValues((previous) => ({ ...previous, [size.name]: event.target.value }))
              }
              placeholder={size.placeholder}
              className={controlClass}
            />
          </Field>
        ) : (
          // Out of the form's questions but not out of the record: the save
          // still writes what is on file, so the box comes back filled in.
          <input key={size.name} type="hidden" name={size.name} value={values[size.name] ?? ""} />
        ),
      )}
    </>
  );
}
