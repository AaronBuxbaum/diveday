"use client";

import { useId, useState } from "react";

/**
 * The "there is more to say, but not on the page" affordance.
 *
 * Settings cards had grown three- and four-sentence descriptions explaining
 * storage units, what a change does and does not convert, and which other
 * surfaces a value appears on. All of it is true and occasionally load-bearing,
 * and all of it was on screen permanently, so a shop scanning for the box it
 * came to change read four paragraphs first. The detail moves in here: a small
 * marker beside the heading, opened by hover, by keyboard focus, or by tap.
 *
 * Three deliberate details:
 *
 * - **The panel is always in the DOM**, hidden with `invisible`/`opacity-0`
 *   rather than unmounted. `aria-describedby` resolves against hidden nodes
 *   when they are referenced by id (accname §4.3.2), so the detail is part of
 *   the trigger's accessible description whether or not anything is hovering —
 *   a screen reader gets the full text on focus without opening anything.
 * - **Tap works.** `:focus-within` alone is unreliable on iOS for a button that
 *   is not a form control, so the trigger also toggles state on click. Hover
 *   stays pure CSS, which is why it costs nothing on a page full of these.
 * - **The trigger is a `<button type="button">`.** These live inside `<form>`
 *   elements on the settings page; the default `type` is `submit`, so leaving
 *   it off would save the shop's settings every time somebody asked what a
 *   field meant.
 */
export function InfoHint({
  label,
  detail,
  className = "",
}: {
  /** Accessible name for the trigger, e.g. "About the depth unit". */
  label: string;
  /** The explanation itself. */
  detail: string;
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);

  return (
    <span className={`group relative inline-flex align-middle ${className}`}>
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        aria-controls={id}
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        onBlur={() => setOpen(false)}
        // No border. The glyph below is already a filled disc, so a ring around
        // it read as a circle drawn around a circle — and beside a heading it
        // looked like a control that had lost its label rather than a marker.
        // Colour alone carries the affordance now; `focus-visible` keeps the
        // keyboard ring, which is the one border that was ever doing work.
        className="inline-flex size-5 items-center justify-center rounded-full text-muted transition-colors hover:text-primary focus-visible:text-primary"
      >
        {/* An icon rather than a "?" glyph: a text marker is copy, and copy
            belongs in a message bundle. This one carries no language at all. */}
        <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3 fill-current">
          <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0Zm0 3.4a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2ZM9.2 12H6.8a.7.7 0 0 1 0-1.4h.5V8.2h-.4a.7.7 0 0 1 0-1.4h1.8v3.8h.5a.7.7 0 0 1 0 1.4Z" />
        </svg>
      </button>
      <span
        id={id}
        role="note"
        className={`pointer-events-none absolute top-7 left-0 z-20 w-72 max-w-[min(18rem,80vw)] rounded-lg border border-border bg-surface p-3 text-xs leading-relaxed font-normal text-muted shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 ${
          open ? "visible opacity-100" : "invisible opacity-0"
        }`}
      >
        {detail}
      </span>
    </span>
  );
}
