"use client";

import { type ReactNode, useActionState, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { Field } from "@/components/ui/form";
import { MAX_IMAGE_BYTES } from "@/lib/storage/limits";
import { type DoctorFormState, sendDoctorFormAction } from "./actions";

const IDLE: DoctorFormState = { status: "idle" };

export type DoctorFormCopy = {
  label: string;
  choose: string;
  chooseAnother: string;
  submit: string;
  sending: string;
  sent: string;
  invalid: string;
  rate: string;
  closed: string;
  unavailable: string;
};

/**
 * **Send the signed doctor's form from the doctor's page** (issue #2797, ADR
 * 20261024-diver-sent-doctors-form). One file, a photo or a PDF; the action
 * stores it privately for the shop's staff and answers with an outcome only.
 * Once the shop has a form the section says so and offers nothing more, so a
 * forwarded copy of the link cannot replace it. The picker is hidden on paper;
 * the other ways back (`fallback`) are not.
 */
export function DoctorFormUpload({
  token,
  copy,
  fallback,
}: {
  token: string;
  copy: DoctorFormCopy;
  /** The shop's email or counter, under the picker until a form is sent. */
  fallback: ReactNode;
}) {
  const [state, formAction] = useActionState(sendDoctorFormAction.bind(null, token), IDLE);
  const [picked, setPicked] = useState<string | null>(null);
  const [tooBig, setTooBig] = useState(false);

  if (state.status === "sent") {
    return <p className="mt-3 text-base text-foreground">{copy.sent}</p>;
  }
  if (state.status === "closed") {
    return <p className="mt-3 text-base text-muted">{copy.closed}</p>;
  }

  const refusal = tooBig
    ? copy.invalid
    : state.status === "invalid"
      ? copy.invalid
      : state.status === "rate"
        ? copy.rate
        : state.status === "unavailable"
          ? copy.unavailable
          : undefined;

  return (
    <>
      <form
        action={formAction}
        encType="multipart/form-data"
        className="mt-4 flex flex-wrap items-end gap-3 print:hidden"
      >
        <Field label={copy.label} error={refusal} htmlFor="doctorForm" className="min-w-56">
          {/* The clearance control's file picker, for the same reason: a bare
            `<input type="file">` speaks the device's language, not the
            page's. `sr-only`, never `hidden`, so the browser can focus it. */}
          <div className="flex flex-wrap items-center gap-3">
            <label
              className={buttonClass({
                variant: "secondary",
                className: "cursor-pointer has-[:focus-visible]:focus-ring",
              })}
            >
              {picked ? copy.chooseAnother : copy.choose}
              <input
                id="doctorForm"
                type="file"
                name="doctorForm"
                required
                accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  // Refused here as well as by the action, so a file over the
                  // cap is never uploaded only to be turned away.
                  const over = Boolean(file && file.size > MAX_IMAGE_BYTES);
                  if (over) event.target.value = "";
                  setTooBig(over);
                  setPicked(over ? null : (file?.name ?? null));
                }}
                className="sr-only"
              />
            </label>
            {picked ? <span className="min-w-0 truncate text-sm text-muted">{picked}</span> : null}
          </div>
        </Field>
        <SubmitButton pendingLabel={copy.sending} className={buttonClass({ variant: "primary" })}>
          {copy.submit}
        </SubmitButton>
      </form>
      {fallback}
    </>
  );
}
