"use client";

import { useEffect } from "react";

const HIGHLIGHT_CLASSES = ["ring-2", "ring-danger", "rounded-lg"];
const HIGHLIGHT_MS = 3_000;

/**
 * Puts the cursor on the field that was refused.
 *
 * A form-level `FormStatus` says *that* a save was refused next to the button
 * that tried it; on a long form that still leaves "which of these twenty boxes"
 * to the eye. When the server can name the offending control, this scrolls it
 * into view, focuses it, and rings it briefly — so a keyboard or screen-reader
 * user lands on the box they have to fix rather than at the top of a fieldset.
 *
 * Two ways to say which field:
 *
 * - `field` — the element's own `id`, for a server that names it (`?field=`).
 * - nothing — falls back to the first `[aria-invalid="true"]` inside `scope`
 *   (or the document), which is what `Field`'s `error` prop marks. That is the
 *   common case: a surface that renders per-field errors gets the focus move
 *   for free, with no second channel for the field name.
 *
 * `key` the element on the submission it belongs to (a nonce, an attempt
 * counter, the notice code) when the same refusal can happen twice in a row —
 * the effect is keyed on what it was told, so an identical repeat refusal needs
 * a remount to re-fire.
 */
export function FieldErrorFocus({ field, scope }: { field?: string; scope?: string }) {
  useEffect(() => {
    const root = scope ? document.getElementById(scope) : document;
    if (!root) return;
    const el = field ? document.getElementById(field) : root.querySelector('[aria-invalid="true"]');
    if (!(el instanceof HTMLElement)) return;

    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // A hidden field (a JSON payload behind a rich editor) has no natural tab
    // stop, but its container still needs a programmatic one to be focusable
    // and to carry the highlight ring where a person can see it.
    if (!el.hasAttribute("tabindex") && !FOCUSABLE.has(el.tagName)) {
      el.setAttribute("tabindex", "-1");
    }
    el.focus({ preventScroll: true });
    el.classList.add(...HIGHLIGHT_CLASSES);
    const timeout = setTimeout(() => el.classList.remove(...HIGHLIGHT_CLASSES), HIGHLIGHT_MS);
    return () => clearTimeout(timeout);
  }, [field, scope]);

  return null;
}

const FOCUSABLE = new Set(["INPUT", "SELECT", "TEXTAREA", "BUTTON", "A"]);
