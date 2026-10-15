"use client";

import { useEffect, useRef } from "react";
import { draftableFields } from "@/lib/form-drafts";
import { applyFormFields } from "./apply-form-fields";

/** Where a form's last submission waits, per tab, until the answer comes back. */
export function keptTypedKey(form: string): string {
  return `diveday.refused-form.${form}`;
}

/**
 * What this tab last submitted from `form`, for a control that holds its own
 * state (a cart's picks) and so cannot be filled the way a keystroke would.
 */
export function readKeptTyped(form: string): Record<string, string> | null {
  return readKept(form);
}

function readKept(form: string): Record<string, string> | null {
  try {
    const raw = window.sessionStorage.getItem(keptTypedKey(form));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const fields: Record<string, string> = {};
    for (const [name, value] of Object.entries(parsed)) {
      if (typeof value === "string") fields[name] = value;
    }
    return fields;
  } catch {
    return null;
  }
}

function forgetKept(form: string) {
  try {
    window.sessionStorage.removeItem(keptTypedKey(form));
  } catch {
    // Storage refused (a private window): nothing was kept to forget.
  }
}

/**
 * **A refusal keeps what was typed** (fifth loop, item 14). A staff form that
 * posts to a server action and is answered with a redirect comes back empty,
 * so a refused tag meant retyping the serial number and the brand beside it,
 * and a refused date meant retyping the customer's paragraph.
 *
 * Mounted inside the form. On submit it keeps the form's fields for this tab
 * (never the draft never-list: payment details, medical answers); when the
 * page comes back with this form's refusal (`restore`), it puts them back, and
 * on any other answer it forgets them. React clears a form once its action
 * settles, which can land after the refusal has painted, so a reset while the
 * refusal is showing puts them back again.
 *
 * Renders nothing; the field-named refusal beside the control says what to fix.
 */
export function KeepTypedOnRefusal({ form, restore }: { form: string; restore: boolean }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const restoreRef = useRef(restore);
  restoreRef.current = restore;

  useEffect(() => {
    const element = anchor.current?.closest("form");
    if (!element) return;
    if (!restore) {
      forgetKept(form);
      return;
    }
    const kept = readKept(form);
    if (kept) applyFormFields(element, kept);
  }, [form, restore]);

  useEffect(() => {
    const element = anchor.current?.closest("form");
    if (!element) return;
    const onSubmit = () => {
      const fields = draftableFields(
        [...new FormData(element).entries()].filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
      try {
        window.sessionStorage.setItem(keptTypedKey(form), JSON.stringify(fields));
      } catch {
        // Storage refused: the refusal still names the field, the values are lost as before.
      }
    };
    let frame = 0;
    const onReset = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!restoreRef.current) return;
        const kept = readKept(form);
        if (kept) applyFormFields(element, kept);
      });
    };
    element.addEventListener("submit", onSubmit);
    element.addEventListener("reset", onReset);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener("submit", onSubmit);
      element.removeEventListener("reset", onReset);
    };
  }, [form]);

  return <span ref={anchor} hidden />;
}
