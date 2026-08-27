// i18n-exempt-file: type-only action signature; all visible copy arrives as translated props.
"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions } from "@/components/ui/form";
import { Modal } from "@/components/ui/Modal";

/**
 * The trigger and the form both used to be "Status": a single card titled
 * generically, with a note field ("Why it's coming off the wall") sitting
 * inline and always visible whether or not staff were pulling the unit. A
 * button that opens the note in its own dialog states the act plainly —
 * "Pull for service" is both the question and the answer — and keeps the
 * Status card itself down to what is actually a unit's resting state.
 */
export function PullForServiceButton({
  gearItemId,
  action,
  copy,
}: {
  gearItemId: string;
  action: (formData: FormData) => void | Promise<void>;
  copy: {
    trigger: string;
    noteLabel: string;
    noteHint: string;
    notePlaceholder: string;
    cancel: string;
    pending: string;
  };
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonClass({ variant: "secondary" })}
      >
        {copy.trigger}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={copy.trigger}>
        <form action={action} className="grid gap-4">
          <input type="hidden" name="gearItemId" value={gearItemId} />
          <input type="hidden" name="status" value="needs_service" />
          <Field label={copy.noteLabel} hint={copy.noteHint}>
            <textarea
              name="serviceNote"
              maxLength={300}
              rows={3}
              placeholder={copy.notePlaceholder}
              className={controlClass}
            />
          </Field>
          <FieldActions>
            <SubmitButton pendingLabel={copy.pending} className={buttonClass()}>
              {copy.trigger}
            </SubmitButton>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className={buttonClass({ variant: "ghost" })}
            >
              {copy.cancel}
            </button>
          </FieldActions>
        </form>
      </Modal>
    </>
  );
}
