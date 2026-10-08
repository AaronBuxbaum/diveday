"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { INSET_NOTE_BOX } from "@/components/ui/card";
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

  /**
   * **The draft that was on file when the form opened, applied once.** Every
   * server action on a staff page refreshes the route (the session read
   * re-sets its cookie cache, and Next treats any cookie write as a
   * mutation), so this component is handed the draft again — as a new object,
   * and once it has saved one, as that snapshot — after every answer the page
   * gets. Applying on each of those put the snapshot back over whatever was
   * typed or picked since it went out (issues #2197, #2223). What is on file
   * later is what is already in the form.
   */
  const [openingDraft] = useState(draft);
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on mount — the whole point of this effect (see above).
  useEffect(() => {
    const element = anchor.current?.closest("form");
    if (element && openingDraft && applyFormFields(element, openingDraft.fields)) setApplied(true);
  }, []);

  // The newest actions, read when the save runs rather than subscribed to:
  // a refreshed page hands in new function objects, and re-binding the
  // listeners on each one cleared the pending debounce before it could fire.
  const save = useEffectEvent((element: HTMLFormElement) => {
    if (submitted.current) return;
    const fields = draftableFields(
      [...new FormData(element).entries()].filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    void actions.save(form, Object.entries(fields));
  });

  useEffect(() => {
    const element = anchor.current?.closest("form");
    if (!element) return;
    const onFocusOut = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => save(element), SAVE_DEBOUNCE_MS);
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") save(element);
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
  }, []);

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
      {applied && openingDraft ? (
        <p
          role="status"
          className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${INSET_NOTE_BOX} bg-surface-sunken`}
        >
          <span>{fill(copy.pickedUp, { time: openingDraft.savedAtLabel })}</span>
          <button
            type="button"
            onClick={startOver}
            className={buttonClass({ variant: "link", size: "sm", flush: true })}
          >
            {copy.startOver}
          </button>
        </p>
      ) : null}
    </span>
  );
}
