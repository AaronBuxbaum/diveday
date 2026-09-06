"use client";

import { useEffect, useRef, useState } from "react";
import { discardFormDraftAction, saveFormDraftAction } from "@/app/actions/form-drafts";
import { buttonClass } from "@/components/ui/button";
import { fill } from "@/i18n/fill";
import {
  type DraftFields,
  draftableFields,
  type FormDraftKind,
  isDraftableField,
} from "@/lib/form-drafts";

export type FormDraftCopy = {
  /** "Picked up from the desk, {time}." */
  pickedUp: string;
  startOver: string;
};

export type FormDraftProps = {
  form: FormDraftKind;
  /** The fresh draft on file for this person, read server-side; null when there is none. */
  draft: { fields: DraftFields; savedAtLabel: string } | null;
  copy: FormDraftCopy;
};

const SAVE_DEBOUNCE_MS = 600;

/**
 * Nothing you typed is lost (ADR 20260906-before-you-ask, decision 3).
 *
 * Mounted inside a staff form. On mount it applies the draft on file to the
 * form's own fields and says so in one line, with Start over as the one act;
 * from then on it keeps a draft of what is typed, written on blur and when the
 * page is hidden, and stops once the form is submitted. Renders nothing at all
 * when there is no draft — the line is the only thing it adds to a surface.
 *
 * Applying goes through each control's native value setter and an `input`
 * event, so a React-managed control (a `ForgivingInput`, a preview that reads
 * a field) sees the change the way it sees a keystroke. Fields on the
 * never-list (`isDraftableField`) are neither saved nor applied.
 */
export function FormDraft({ form, draft, copy }: FormDraftProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [applied, setApplied] = useState(false);
  const submitted = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const element = anchor.current?.closest("form");
    if (!element) return;
    if (draft && applyDraft(element, draft.fields)) setApplied(true);

    const save = () => {
      if (submitted.current) return;
      const fields = draftableFields(
        [...new FormData(element).entries()].filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
      void saveFormDraftAction(form, Object.entries(fields));
    };
    const onFocusOut = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(save, SAVE_DEBOUNCE_MS);
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") save();
    };
    const onSubmit = () => {
      submitted.current = true;
      if (timer.current) clearTimeout(timer.current);
    };
    element.addEventListener("focusout", onFocusOut);
    element.addEventListener("submit", onSubmit);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      element.removeEventListener("focusout", onFocusOut);
      element.removeEventListener("submit", onSubmit);
      document.removeEventListener("visibilitychange", onHidden);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [form, draft]);

  async function startOver() {
    const element = anchor.current?.closest("form");
    submitted.current = true;
    setApplied(false);
    element?.reset();
    await discardFormDraftAction(form);
    submitted.current = false;
  }

  return (
    <span ref={anchor} className="contents">
      {applied && draft ? (
        <p
          role="status"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-inset bg-surface-sunken px-3 py-2 text-sm"
        >
          <span>{fill(copy.pickedUp, { time: draft.savedAtLabel })}</span>
          <button
            type="button"
            onClick={startOver}
            className={buttonClass({ variant: "link", size: "sm", className: "px-0" })}
          >
            {copy.startOver}
          </button>
        </p>
      ) : null}
    </span>
  );
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = Object.getPrototypeOf(element) as object;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) setter.call(element, value);
  else element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Puts the draft into the form's controls; true when at least one took a value. */
function applyDraft(form: HTMLFormElement, fields: DraftFields): boolean {
  let applied = false;
  for (const [name, value] of Object.entries(fields)) {
    // The never-list holds on the way back in as well as on the way out.
    if (!isDraftableField(name)) continue;
    const selector = name.replace(/["\\]/g, "\\$&");
    const controls = [
      ...form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        `[name="${selector}"], [data-draft-for="${selector}"]`,
      ),
    ];
    for (const control of controls) {
      if (control instanceof HTMLSelectElement) {
        if ([...control.options].some((option) => option.value === value)) {
          control.value = value;
          control.dispatchEvent(new Event("change", { bubbles: true }));
          applied = true;
        }
        continue;
      }
      if (control instanceof HTMLInputElement) {
        if (control.type === "hidden" || control.type === "file" || control.type === "submit") {
          continue;
        }
        if (control.type === "checkbox" || control.type === "radio") {
          const checked = value.split(" ").includes(control.value);
          if (control.checked !== checked) {
            control.click();
            applied = true;
          }
          continue;
        }
      }
      if (control.value !== value) {
        setNativeValue(control, value);
        applied = true;
      }
    }
  }
  return applied;
}
