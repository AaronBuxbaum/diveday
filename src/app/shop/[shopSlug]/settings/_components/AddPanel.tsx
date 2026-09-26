import type { ReactNode } from "react";

/**
 * **The "Add a …" panel under a settings list** — kinds of day, seasons,
 * boats: a dashed, sunken box holding the form that adds one more row to the
 * list directly above it.
 *
 * Its inset is the list rows' own `p-3`, so a field in the panel starts and
 * ends on the same x as the fields in the rows above it. Each page used to
 * spell the panel by hand at `p-4`, and the panel's boxes stood 4px inside the
 * rows' on both sides (x 470 against 466 at 1280; the pixel probe, K-234).
 *
 * The form is the caller's: a row of one box and its button, or a
 * `FieldGrid`. A column-direction form row wants `items-start`, so its submit
 * keeps its own width below `sm` rather than stretching into a bar (K-252).
 */
export function AddPanel({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface-sunken p-3">
      <h2 className="mb-3 text-sm font-medium">{title}</h2>
      {children}
    </div>
  );
}
