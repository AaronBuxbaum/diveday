"use client";

import { useEffect } from "react";

const HIGHLIGHT_CLASSES = ["ring-2", "ring-danger", "rounded-lg"];
const HIGHLIGHT_MS = 3_000;

/**
 * `courses.edit.errorInvalid` used to be one generic message over ~15 inputs
 * with no way to tell which one failed. The server now names the failing
 * field (`?field=<name>`); this finds the element carrying that id, scrolls
 * it into view, focuses it, and rings it briefly so the field that actually
 * needs attention is unmistakable — instead of a diver-facing form editor
 * left to scan every fieldset by eye.
 */
export function FieldErrorFocus({ field }: { field?: string }) {
  useEffect(() => {
    if (!field) return;
    const el = document.getElementById(field);
    if (!el) return;

    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // A hidden field (the day-by-day JSON) has no natural tab stop, but its
    // containing fieldset still needs a programmatic one to be focusable and
    // to carry the highlight ring where a person can actually see it.
    if (!(el instanceof HTMLElement)) return;
    if (!el.hasAttribute("tabindex") && el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") {
      el.setAttribute("tabindex", "-1");
    }
    el.focus({ preventScroll: true });
    el.classList.add(...HIGHLIGHT_CLASSES);
    const timeout = setTimeout(() => el.classList.remove(...HIGHLIGHT_CLASSES), HIGHLIGHT_MS);
    return () => clearTimeout(timeout);
  }, [field]);

  return null;
}
