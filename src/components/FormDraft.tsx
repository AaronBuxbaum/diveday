"use client";

import { useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { fill } from "@/i18n/fill";
import { type DraftFields, draftableFields, type FormDraftKind } from "@/lib/form-drafts";
import { applyFormFields } from "./apply-form-fields";

export type FormDraftCopy = {
  /** "Picked up from the desk, {time}." */
  pickedUp: string;
  startOver: string;
};

/**
 * The two server actions a draft needs, handed in by the page — a component
 * under `src/components` never reaches into `src/app` for them (ADR
 * 20260730-feature-module-contracts), and the page is where the session is.
 */
export type FormDraftActions = {
  save: (form: FormDraftKind, fields: Array<[string, string]>) => Promise<void>;
  discard: (form: FormDraftKind) => Promise<void>;
};

export type FormDraftProps = {
  form: FormDraftKind;
  /** The fresh draft on file for this person, read server-side; null when there is none. */
  draft: { fields: DraftFields; savedAtLabel: string } | null;
  actions: FormDraftActions;
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
 * Applying goes through `applyFormFields`, so a React-managed control sees the
 * change the way it sees a keystroke; fields on the never-list are neither
 * saved nor applied.
 */
export function FormDraft({ form, draft, actions, copy }: FormDraftProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [applied, setApplied] = useState(false);
  const submitted = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const element = anchor.current?.closest("form");
    if (!element) return;
    if (draft && applyFormFields(element, draft.fields)) setApplied(true);

    const save = () => {
      if (submitted.current) return;
      const fields = draftableFields(
        [...new FormData(element).entries()].filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
      void actions.save(form, Object.entries(fields));
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
  }, [form, draft, actions]);

  async function startOver() {
    const element = anchor.current?.closest("form");
    submitted.current = true;
    setApplied(false);
    element?.reset();
    await actions.discard(form);
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
