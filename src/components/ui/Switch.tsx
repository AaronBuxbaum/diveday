import type { ReactNode } from "react";

/**
 * **The one sliding on/off switch: a track, a thumb, and a label beside it.**
 *
 * Two surfaces drew this by hand with byte-identical class strings — the water
 * locker's "keep the screen from answering wet fingers" and the haptics
 * toggle — which is the drift `buttonClass()`, `SegmentedControl` and `Pager`
 * each exist to end. If a switch looks wrong, fix it here, never at a call
 * site.
 *
 * **A switch is not a checkbox, and the difference is when it takes effect.**
 * This is for a setting that applies the moment it is tapped: the device is
 * locked *now*, the phone stops buzzing *now*. A choice that only means
 * something once a form is submitted stays a plain
 * `<input type="checkbox" className="size-4 accent-primary">` — Settings →
 * Team's role boxes, a departure's requirement toggles, the buddy-team and
 * waiver boxes. Roughly 25 of those, and none of them should slide: a control
 * that animates into its new state is telling the reader something happened,
 * and for a form field nothing has.
 *
 * The mechanics it guarantees, so no caller has to remember them:
 *
 * - **A real checkbox underneath**, visually hidden and carrying
 *   `role="switch"`. The whole thing is a `<label>`, so the label text is the
 *   accessible name and tapping anywhere on it toggles. `aria-checked` is
 *   derived from the same prop as `checked`, so the two cannot disagree.
 * - **Dock-test target.** `min-h-11` (44px) on the label, and the switch is a
 *   `shrink-0` 44×24 track so a long label wraps rather than squeezing it.
 * - **The thumb slides.** A bare `transition-transform`, so it takes the app's
 *   default curve and duration and `prefers-reduced-motion` stills it through
 *   the global kill-switch in `globals.css` (docs/design/forms-and-controls.md,
 *   "Motion: write a bare `transition-*`").
 * - **Never on paper.** A control that changes a setting means nothing
 *   printed.
 * - **The resting thumb is placed logically** (`after:start-1`), which is what
 *   the two hand-rolled copies were grandfathered out of. The *travel* is a
 *   physical `translate-x-5`, deliberately: `check:logical-properties` covers
 *   inset and spacing utilities, not transforms, and this repo ships no
 *   right-to-left locale to write the second half against. A locale that
 *   arrives will want this line, and it is one line.
 */
export function Switch({
  checked,
  onChange,
  label,
  className = "",
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The words beside the switch. They are its accessible name. */
  label: ReactNode;
  className?: string;
}) {
  return (
    <label
      className={`group inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface-sunken p-3 text-sm font-medium text-muted transition-colors hover:border-border-strong hover:text-foreground print:hidden ${className}`.trim()}
    >
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        // Redundant to a browser — a checked checkbox with `role="switch"`
        // already exposes the switch state — and required by the lint rule
        // that cannot see the native mapping. Derived from the same prop as
        // `checked`, so the two cannot disagree.
        aria-checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      {/* Decorative: the input above carries the state and the label carries
          the name, so this is the drawing of both and nothing a reader needs
          to hear twice. */}
      <span
        aria-hidden="true"
        className="relative h-6 w-11 shrink-0 rounded-full bg-border transition-colors after:absolute after:top-1 after:start-1 after:size-4 after:rounded-full after:bg-surface after:shadow-sm after:transition-transform peer-checked:bg-primary peer-checked:after:translate-x-5 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary"
      />
      {label}
    </label>
  );
}
