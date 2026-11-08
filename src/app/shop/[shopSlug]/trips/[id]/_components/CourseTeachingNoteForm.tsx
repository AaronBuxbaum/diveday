"use client";

import { useActionState, useEffect, useState } from "react";
import { undoAction } from "@/app/actions/undo";
import { SubmitButton } from "@/components/SubmitButton";
import { UndoToast } from "@/components/UndoToast";
import { buttonClass } from "@/components/ui/button";
import { Field, FieldActions, FormStatus, textareaClassFor } from "@/components/ui/form";
import type { CourseTeachingNoteResult } from "@/db/course-pulse";
import { COURSE_TEACHING_NOTE_MAX } from "@/lib/course-pulse";

export function CourseTeachingNoteForm({
  note,
  tripId,
  shopSlug,
  action,
  words,
}: {
  note: string | null;
  tripId: string;
  shopSlug: string;
  action: (
    previous: CourseTeachingNoteResult | null,
    form: FormData,
  ) => Promise<CourseTeachingNoteResult>;
  words: {
    label: string;
    audience: string;
    save: string;
    remove: string;
    busy: string;
    saved: string;
    deleted: string;
    undo: string;
    dismiss: string;
    errors: Record<Extract<CourseTeachingNoteResult, { ok: false }>["reason"], string>;
  };
}) {
  const [undoRevision, setUndoRevision] = useState<number | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [result, submit] = useActionState(
    async (previous: CourseTeachingNoteResult | null, form: FormData) => {
      const next = await action(previous, form);
      if (next.ok) {
        setUndoRevision(next.deletedRevision ?? null);
        setUndoing(false);
      }
      return next;
    },
    null,
  );
  const [draft, setDraft] = useState(note ?? "");
  const [expected, setExpected] = useState(note);
  useEffect(() => {
    if (result?.ok) {
      setExpected(result.note);
      setDraft(result.note ?? "");
    }
  }, [result]);
  useEffect(() => {
    if (undoing && note) {
      setDraft(note);
      setExpected(note);
      setUndoRevision(null);
    }
  }, [note, undoing]);
  return (
    <>
      {undoRevision && !undoing ? (
        <UndoToast
          placement="inline"
          message={words.deleted}
          action={async (form) => {
            setUndoing(true);
            await undoAction(shopSlug, form);
          }}
          fields={{
            undo: "course-teaching-note",
            undoTrip: tripId,
            undoRevision: String(undoRevision),
          }}
          pendingLabel={words.busy}
          undoLabel={words.undo}
          dismissLabel={words.dismiss}
        />
      ) : null}
      <form action={submit} className="mt-4">
        <input type="hidden" name="expectedNote" value={expected ?? ""} />
        <Field label={words.label} description={words.audience} htmlFor="course-teaching-note">
          <textarea
            id="course-teaching-note"
            name="note"
            rows={3}
            maxLength={COURSE_TEACHING_NOTE_MAX}
            className={textareaClassFor(3)}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </Field>
        <FieldActions>
          <SubmitButton
            pendingLabel={words.busy}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {words.save}
          </SubmitButton>
          {expected ? (
            <SubmitButton
              name="intent"
              value="delete"
              pendingLabel={words.busy}
              className={buttonClass({ variant: "link", size: "sm" })}
            >
              {words.remove}
            </SubmitButton>
          ) : null}
        </FieldActions>
        <FormStatus tone={result?.ok ? "success" : "danger"}>
          {result
            ? result.ok
              ? result.note
                ? words.saved
                : null
              : words.errors[result.reason]
            : null}
        </FormStatus>
      </form>
    </>
  );
}
