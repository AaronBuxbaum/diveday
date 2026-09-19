"use client";

import { useState } from "react";
import { Hull } from "@/components/boat/Hull";
import { controlClass } from "@/components/ui/form";
import { hullGeometry, UNPAINTED_HULL_PICKER_COLOR } from "@/lib/hull";

/**
 * **A shop paints a boat and watches it happen** (ADR 20260919-one-idea,
 * decision I · Tide). The picker, the hex field, and the hull itself in the
 * colour being chosen — the same shape the crew will read on the departure, at
 * the moment the choice is made rather than a page away from it.
 *
 * Shaped after `BrandColorField`, deliberately: the hex field is the one the
 * form submits, because `<input type="color">` can never be blank and blank is
 * how a shop says "leave this hull unpainted". The picker is a hand for the
 * field, not a second source of truth, and an unpainted hull previews in the
 * page's own ink, which is exactly what it will look like.
 *
 * Words arrive as props; this is a staff Client Component.
 */
export function HullColorField({
  initial,
  capacity,
  hint,
  pickerLabel,
  fieldLabel,
  previewLabel,
}: {
  initial: string | null;
  capacity: number;
  /** Why the colour is worth picking — the one thing the field cannot show. */
  hint: string;
  pickerLabel: string;
  fieldLabel: string;
  /** The hull in one sentence, already worded and filled in by the caller. */
  previewLabel: string;
}) {
  const [value, setValue] = useState(initial ?? "");
  // The `#` is optional here because it is optional everywhere else: the field's
  // own `pattern` accepts `abcdef` and `parseBrandColor` stores it as `#abcdef`.
  // Requiring it for the preview alone made the boat go unpainted while the
  // shop typed a colour the server would have taken — a picture disagreeing
  // with the value beside it, which is the one thing a live preview must never
  // do.
  const painted = /^#?([0-9a-f]{6})$/i.exec(value);
  const normalized = painted ? `#${painted[1].toLowerCase()}` : null;
  // The picker needs a colour even when the field is blank; the page's own ink
  // is not a hex it can hold, so it opens on a neutral and the hull stays
  // unpainted until the shop actually picks.
  const picked = normalized ?? UNPAINTED_HULL_PICKER_COLOR;

  return (
    // The boat beside the choice on a desk and under it on a phone: a hull is
    // wide and short, so side by side it reads as one control rather than as a
    // picture that turned up after the form.
    <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center">
      <div className="flex flex-1 flex-col gap-1">
        <div className="flex items-center gap-3">
          <input
            type="color"
            aria-label={pickerLabel}
            value={picked}
            onChange={(event) => setValue(event.target.value)}
            className="size-11 shrink-0 cursor-pointer rounded-lg border border-border-strong bg-surface p-1"
          />
          <input
            name="hullColor"
            type="text"
            maxLength={7}
            pattern="#?[0-9a-fA-F]{6}"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={fieldLabel}
            aria-label={fieldLabel}
            className={`${controlClass} font-mono`}
          />
        </div>
        <p className="text-sm text-muted">{hint}</p>
      </div>
      <Hull
        geometry={hullGeometry({ capacity })}
        label={previewLabel}
        color={normalized}
        className="block h-auto w-full max-w-64 shrink-0"
      />
    </div>
  );
}
