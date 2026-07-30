"use client";

import { useState } from "react";
import { REVIEW_RATINGS } from "@/lib/reviews";

/**
 * The rating input: five real radios, drawn as stars.
 *
 * Radios rather than buttons or a slider so the control arrives
 * keyboard-navigable and screen-reader-labelled for free, and so it still
 * submits if the client bundle never loads — this is a phone-on-a-dock
 * surface, and a failed hydrate must not cost the shop the review. The state
 * below is pure enhancement: it fills the stars up to whatever is hovered or
 * chosen, which the CSS sibling selectors can't do here because each input is
 * nested inside its own label rather than being a sibling of the others.
 */
export function StarRatingInput({
  name = "rating",
  legend,
  optionLabel,
  defaultValue,
}: {
  name?: string;
  legend: string;
  /** Localized "{rating} out of 5 stars" for one value — the accessible name. */
  optionLabel: (rating: number) => string;
  defaultValue?: number;
}) {
  const [selected, setSelected] = useState(defaultValue ?? 0);
  const [hovered, setHovered] = useState(0);
  const lit = hovered || selected;

  return (
    <fieldset onMouseLeave={() => setHovered(0)}>
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="mt-1 flex gap-0.5">
        {REVIEW_RATINGS.map((value) => (
          <label
            key={value}
            onMouseEnter={() => setHovered(value)}
            className="cursor-pointer text-3xl leading-none transition-colors"
          >
            <input
              type="radio"
              name={name}
              value={value}
              required
              defaultChecked={defaultValue === value}
              onChange={() => setSelected(value)}
              className="peer sr-only"
            />
            {/* size-11 keeps every star a 44px tap target even though the
                glyph is smaller (design/principles.md #2), and the ring shows
                keyboard focus, which `sr-only` on the input would otherwise
                hide entirely. */}
            <span
              aria-hidden="true"
              className={`flex size-11 items-center justify-center rounded-lg peer-focus-visible:ring-2 peer-focus-visible:ring-primary ${
                value <= lit ? "text-warning" : "text-border-strong"
              }`}
            >
              ★
            </span>
            <span className="sr-only">{optionLabel(value)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
