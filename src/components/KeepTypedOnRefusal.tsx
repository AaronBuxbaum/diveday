"use client";

import { useEffect, useRef } from "react";
import { MINUTE_MS, nowMs } from "@/lib/clock";
import { type DraftFieldPolicy, draftableFields } from "@/lib/form-drafts";
import { applyFormFields } from "./apply-form-fields";
import { KEPT_PREFIX, keptTypedKey } from "./kept-typed-scope";

export { keptTypedKey, keptTypedScope } from "./kept-typed-scope";

/** A refusal comes back in a second; anything older is a different visit. */
const KEPT_FOR_MS = 10 * MINUTE_MS;

/**
 * What this tab last submitted from `form`, for a control that holds its own
 * state (a cart's picks) and so cannot be filled the way a keystroke would.
 */
export function readKeptTyped(form: string, scope: string): Record<string, string> | null {
  return readKept(form, scope);
}

function readKept(form: string, scope: string): Record<string, string> | null {
  try {
    const raw = window.sessionStorage.getItem(keptTypedKey(form, scope));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const { at, fields: stored } = parsed as { at?: unknown; fields?: unknown };
    if (typeof at !== "number" || nowMs() - at > KEPT_FOR_MS) return null;
    if (stored == null || typeof stored !== "object" || Array.isArray(stored)) return null;
    const fields: Record<string, string> = {};
    for (const [name, value] of Object.entries(stored)) {
      if (typeof value === "string") fields[name] = value;
    }
    return fields;
  } catch {
    return null;
  }
}

export function forgetKeptTyped(form: string, scope: string) {
  try {
    window.sessionStorage.removeItem(keptTypedKey(form, scope));
  } catch {
    // Storage refused (a private window): nothing was kept to forget.
  }
}

/**
 * **Every kept form on this tab, gone**: signing out, and the sign-in page
 * every ended session lands on, leave the next staffer none of the typing.
 */
export function forgetAllKeptTyped(): void {
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index);
      if (key?.startsWith(KEPT_PREFIX)) keys.push(key);
    }
    for (const key of keys) window.sessionStorage.removeItem(key);
  } catch {
    // Storage refused: nothing was kept to forget.
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
export function KeepTypedOnRefusal({
  form,
  scope,
  restore,
  policy,
}: {
  form: string;
  /** {@link keptTypedScope}: the shop and the staffer. */
  scope: string;
  restore: boolean;
  /** A fixed, narrowly scoped exception to the shared sensitive-name filter. */
  policy?: DraftFieldPolicy;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const restoreRef = useRef(restore);
  const effectivePolicy = form === "boats-add" ? policy : undefined;
  restoreRef.current = restore;

  useEffect(() => {
    const element = anchor.current?.closest("form");
    if (!element) return;
    if (!restore) {
      forgetKeptTyped(form, scope);
      return;
    }
    const kept = readKept(form, scope);
    if (kept) applyFormFields(element, kept, effectivePolicy);
  }, [form, scope, restore, effectivePolicy]);

  useEffect(() => {
    const element = anchor.current?.closest("form");
    if (!element) return;
    const onSubmit = () => {
      const fields = draftableFields(
        [...new FormData(element).entries()].filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
        effectivePolicy,
      );
      try {
        window.sessionStorage.setItem(
          keptTypedKey(form, scope),
          JSON.stringify({ at: nowMs(), fields }),
        );
      } catch {
        // Storage refused: the refusal still names the field, the values are lost as before.
      }
    };
    let frame = 0;
    const onReset = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!restoreRef.current) return;
        const kept = readKept(form, scope);
        if (kept) applyFormFields(element, kept, effectivePolicy);
      });
    };
    element.addEventListener("submit", onSubmit);
    element.addEventListener("reset", onReset);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener("submit", onSubmit);
      element.removeEventListener("reset", onReset);
    };
  }, [form, scope, effectivePolicy]);

  return <span ref={anchor} hidden />;
}
