"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
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

function snapshot(element: HTMLFormElement): Array<[string, string]> {
  return Object.entries(
    draftableFields(
      [...new FormData(element).entries()].filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
  );
}

/**
 * Nothing you typed is lost (ADR 20260906-before-you-ask, decision 3).
 *
 * Mounted inside a staff form. On mount it applies the draft on file to the
 * form's own fields and says so in one line, with Start over as the one act;
 * from then on it keeps a draft of what is typed, written after edits and on
 * internal navigation, and stops while the form is submitted. Renders nothing at all
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
  const dispatchedSubmit = useRef(false);
  const discarding = useRef(false);
  const [discardPending, setDiscardPending] = useState(false);
  const latest = useRef<Array<[string, string]>>([]);
  const revision = useRef(0);
  const savedRevision = useRef(0);
  const queuedRevision = useRef(0);
  const writes = useRef(Promise.resolve());
  const { pending } = useFormStatus();
  const wasPending = useRef(false);
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

  // A server refresh can replace the action references without rebinding the
  // listeners or cancelling their timer. Each queued write keeps its own copy.
  const save = useEffectEvent(() => {
    if (submitted.current || discarding.current || revision.current <= queuedRevision.current)
      return writes.current;
    const fields = latest.current;
    const version = revision.current;
    const saveAction = actions.save;
    queuedRevision.current = version;
    writes.current = writes.current.then(async () => {
      try {
        await saveAction(form, fields);
        savedRevision.current = version;
      } catch {
        // Keep the unsaved snapshot eligible for the next edit, blur or leave.
        if (queuedRevision.current === version) queuedRevision.current = savedRevision.current;
      }
    });
    return writes.current;
  });

  const capture = useEffectEvent((element: HTMLFormElement) => {
    const fields = snapshot(element);
    if (JSON.stringify(fields) !== JSON.stringify(latest.current)) {
      latest.current = fields;
      revision.current += 1;
    }
  });

  // A refused action can leave this form mounted. Resume saving after it
  // answers, with the current form as the baseline (React resets a successful
  // form). Successful navigation unmounts while `submitted` is still true.
  useEffect(() => {
    if (pending) wasPending.current = true;
    else if (wasPending.current) {
      wasPending.current = false;
      submitted.current = false;
      dispatchedSubmit.current = false;
      const element = anchor.current?.closest("form");
      if (element) latest.current = snapshot(element);
    }
  }, [pending]);

  useEffect(() => {
    const element = anchor.current?.closest("form");
    if (!element) return;
    latest.current = snapshot(element);
    let mounted = true;
    let replayingSubmit = false;
    const cancelTimer = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
    const onEdit = () => {
      capture(element);
      cancelTimer();
      timer.current = setTimeout(() => void save(), SAVE_DEBOUNCE_MS);
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") {
        capture(element);
        cancelTimer();
        void save();
      }
    };
    const onSubmit = (event: SubmitEvent) => {
      if (replayingSubmit) {
        dispatchedSubmit.current = true;
        return;
      }
      if (submitted.current || discarding.current) {
        event.preventDefault();
        return;
      }
      capture(element);
      cancelTimer();
      const settled = save();
      submitted.current = true;
      // The successful server mutation discards its draft. Let every older
      // save finish before that mutation can run, so none can resurrect it.
      event.preventDefault();
      const submitter = event.submitter;
      const version = revision.current;
      void (async () => {
        let submittedVersion = version;
        await settled;
        while (mounted) {
          capture(element);
          if (revision.current === submittedVersion) break;
          submittedVersion = revision.current;
          submitted.current = false;
          const newest = save();
          submitted.current = true;
          await newest;
        }
        if (!mounted) return;
        dispatchedSubmit.current = false;
        replayingSubmit = true;
        element.requestSubmit(submitter);
        replayingSubmit = false;
        // Edits made while waiting may now fail native constraint validation.
        if (!dispatchedSubmit.current) submitted.current = false;
      })();
    };
    element.addEventListener("input", onEdit);
    element.addEventListener("change", onEdit);
    element.addEventListener("focusout", onEdit);
    element.addEventListener("submit", onSubmit);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      mounted = false;
      element.removeEventListener("input", onEdit);
      element.removeEventListener("change", onEdit);
      element.removeEventListener("focusout", onEdit);
      element.removeEventListener("submit", onSubmit);
      document.removeEventListener("visibilitychange", onHidden);
      cancelTimer();
      // Retain the last input snapshot: React may already have removed the
      // form's fields by passive-effect cleanup. No browser storage is used.
      if (!dispatchedSubmit.current) submitted.current = false;
      void save();
    };
  }, []);

  async function startOver() {
    if (discarding.current || submitted.current) return;
    const element = anchor.current?.closest("form");
    discarding.current = true;
    setDiscardPending(true);
    if (timer.current) clearTimeout(timer.current);
    const version = revision.current;
    try {
      await writes.current;
      await actions.discard(form);
      // Do not wipe edits made while the discard was in flight.
      if (version === revision.current) {
        element?.reset();
        if (element) latest.current = snapshot(element);
        savedRevision.current = revision.current;
        queuedRevision.current = revision.current;
        setApplied(false);
      }
    } catch {
      // Keep both the fields and the recovery line when the discard fails.
    } finally {
      discarding.current = false;
      setDiscardPending(false);
      void save();
    }
  }

  return (
    <span ref={anchor} className="contents">
      {applied && openingDraft ? (
        <p
          role="status"
          className={`col-span-full flex flex-wrap items-center gap-x-3 gap-y-1 ${INSET_NOTE_BOX} bg-surface-sunken`}
        >
          <span>{fill(copy.pickedUp, { time: openingDraft.savedAtLabel })}</span>
          <button
            type="button"
            onClick={startOver}
            disabled={discardPending}
            className={buttonClass({ variant: "link", size: "sm", flush: true })}
          >
            {copy.startOver}
          </button>
        </p>
      ) : null}
    </span>
  );
}
