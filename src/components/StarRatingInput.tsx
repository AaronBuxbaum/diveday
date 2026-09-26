"use client";

import { useState } from "react";
import { STAR_INK_VIEWBOX, STAR_PATH } from "@/components/StarRating";
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
  optionLabels,
  defaultValue,
}: {
  name?: string;
  legend: string;
  /**
   * The accessible name for each star, already translated, keyed by rating.
   *
   * Deliberately data rather than a `(rating) => string` callback: this is a
   * Client Component, and React refuses a function passed across that boundary
   * from a Server Component — which crashed the whole server render of every
   * page that used it. Five strings cross fine.
   */
  optionLabels: Record<number, string>;
  defaultValue?: number;
}) {
  const [selected, setSelected] = useState(defaultValue ?? 0);
  const [hovered, setHovered] = useState(0);
  const lit = hovered || selected;

  return (
    <fieldset onMouseLeave={() => setHovered(0)}>
      <legend className="text-sm font-medium">{legend}</legend>
      {/* The targets hang, the way `InfoHint`'s do: each 44px target keeps
          8px of air around its 28px star, so the row is pulled out by those
          8px and the first star's ink lands on the column the legend and the
          comment box start on. It kept 9px inside it, and 26px of empty
          target under the stars where the form's rows sit 12px apart
          (pixel-craft K-478). The top keeps the legend's 4px, less the air. */}
      <div className="-mx-2 -mt-1 -mb-2 flex gap-0.5">
        {REVIEW_RATINGS.map((value) => (
          // The label is the 44px target (design/principles.md #2) and the
          // radio fills it invisibly rather than sitting `sr-only` in a corner:
          // a 1px-clipped input is not something a pointer — or an automated
          // click — can actually land on, so the label ends up swallowing every
          // press aimed at the control itself.
          <label
            key={value}
            onMouseEnter={() => setHovered(value)}
            className="relative flex size-11 cursor-pointer items-center justify-center transition-colors"
          >
            <input
              type="radio"
              name={name}
              value={value}
              required
              defaultChecked={defaultValue === value}
              onChange={() => setSelected(value)}
              className="peer absolute inset-0 size-full cursor-pointer opacity-0"
            />
            {/* The ring shows keyboard focus, which the transparent input above
                would otherwise hide entirely. It rings the star's own box, 8px
                inside the 44px target, not the target: the hang lifts the
                target 4px over the legend, and a ring 5px outside that ran
                through the legend's letters (pixel-craft K-478). Here its top
                arm sits just under the legend, as it did before the hang. */}
            <span
              aria-hidden="true"
              className={`pointer-events-none flex size-7 rounded-lg peer-focus-visible:focus-ring ${
                value <= lit ? "text-warning" : "text-border-strong"
              }`}
            >
              {/* Drawn, the same star `StarRating` shows the rating back in,
                  in a box cropped to its ink so the hang above is exact. */}
              <svg viewBox={STAR_INK_VIEWBOX} aria-hidden="true" className="size-7">
                <path fill="currentColor" d={STAR_PATH} />
              </svg>
            </span>
            <span className="sr-only">{optionLabels[value]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
