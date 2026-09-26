"use client";

import { useEffect, useState } from "react";
import type { MedicalClearanceCopy } from "@/components/medical-clearance-copy";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import {
  ChoiceFieldset,
  ChoicePill,
  controlClass,
  DateField,
  Field,
  FieldGrid,
} from "@/components/ui/form";
import { WaiverActionIcon } from "@/components/WaiverActionIcon";

/**
 * **"Here is what the physician said" — the one door out of a medical hold, and
 * since issue #1283 the one door out of the waiting too.**
 *
 * The questionnaire refers a diver, the release parks in review, and readiness
 * refuses to board them. The diver then comes back with a signed physician
 * evaluation, and before this there was nowhere to put it: the only lift was
 * the paper-waiver attestation, whose checkbox says *no answer needs physician
 * sign-off* — the opposite of what the diver is holding (issue #1252).
 *
 * **Both answers, and neither is the default.** The RSTC form has two outcomes
 * and the first cut of this control could only record one, so a diver who came
 * back disapproved sat in "waiting" forever while the shop chased an answer
 * that had already arrived. The outcome is a required radio pair with nothing
 * pre-selected rather than two submit buttons: a refusal is final on the record
 * it lands on, and a form where the wrong answer is one mis-tap away is the
 * wrong shape for a write nobody can take back.
 *
 * So it is a separate control from `PaperWaiverControl`, and shaped the same
 * way for the same reasons: an explicit open/cancel pair rather than a
 * `<details>`, and `defaultOpen` so a refusal comes back with the form still
 * standing instead of collapsed over its own error.
 *
 * **No attestation checkbox, but real evidence.** The paper control has a
 * checkbox because a staffer is asserting something about a form the app never
 * saw. Here the assertion *is* the act — so instead of a box to tick, the form
 * asks for what a claims adjuster will ask for: the day the physician evaluated
 * the diver, and either their evaluation or their name. A `dive-domain-expert`
 * review put it plainly: without one of those, the record says only that one of
 * the shop's own staff pressed a button, which is the hearsay the checkbox next
 * door exists to avoid.
 *
 * **The evaluation date is the physician's, not the shop's.** It is what the
 * release ages on alongside the signature, and it is what refuses a "fit to
 * dive" letter written before the disclosure it is supposed to answer.
 */
export function MedicalClearanceControl({
  action,
  copy,
  className = "mt-2",
  variant = "secondary",
  defaultOpen = false,
  today,
}: {
  // i18n-exempt: type annotation, not copy.
  action: (formData: FormData) => void | Promise<void>;
  copy: MedicalClearanceCopy;
  /**
   * The shop's own today, as an ISO calendar date, so the date box cannot
   * offer tomorrow. Passed in rather than read here: a Client Component reading
   * `new Date()` would use the *reader's* zone, and a Key Largo evening is
   * already tomorrow in UTC.
   */
  today: string;
  className?: string;
  variant?: "link" | "secondary" | "ghost";
  /** Open on mount — for a refusal landing back on the form that produced it. */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonClass({
          variant,
          size: "sm",
          flush: variant === "link",
          className: `gap-2 ${className}`,
        })}
      >
        <WaiverActionIcon name="paper" />
        {copy.recordClearance}
      </button>
    );
  }

  return (
    <form
      action={action}
      encType="multipart/form-data"
      className={`${className} w-full max-w-md rounded-xl border border-border bg-surface-sunken p-4`}
    >
      <FieldGrid columns={1}>
        {/* A fieldset rather than a `Field`: the legend is the question and the
            two inputs answer it together, which is the one control shape
            `Field`'s single-`htmlFor` caption cannot describe. `required` on
            both radios is what makes "no answer" unsubmittable — there is no
            default here, on purpose — and `required` on the group draws the
            `*` that says so: without it the outcome would be the only
            mandatory control on this form not saying so. */}
        <ChoiceFieldset legend={copy.outcomeLegend} required bodyClassName="flex flex-wrap gap-3">
          <ChoicePill type="radio" name="outcome" value="cleared" required>
            {copy.outcomeCleared}
          </ChoicePill>
          <ChoicePill type="radio" name="outcome" value="not_cleared" required>
            {copy.outcomeNotCleared}
          </ChoicePill>
        </ChoiceFieldset>
        <Field label={copy.evaluatedOnLabel} htmlFor="evaluatedOn">
          <DateField id="evaluatedOn" name="evaluatedOn" required max={today} />
        </Field>
        {/* `description`, not `hint`: `hint` renders inside the caption `<label>`,
            so a whole sentence there becomes part of the control's accessible
            *name* and a screen reader reads it out every time the field is
            announced. `description` is the `aria-describedby` slot `Field`
            exists to wire (its own docblock). */}
        <Field
          label={copy.physicianNameLabel}
          description={copy.evidenceHint}
          htmlFor="physicianName"
        >
          <input
            id="physicianName"
            type="text"
            name="physicianName"
            maxLength={120}
            autoComplete="off"
            className={controlClass}
          />
        </Field>
        <Field
          label={copy.documentLabel}
          description={copy.documentHint}
          htmlFor="medicalClearanceDocument"
        >
          {/* `ImageFileInput`'s treatment, by hand because that component is
              image-only (`ALLOWED_IMAGE_CONTENT_TYPES`) and a physician's
              evaluation arrives as a PDF as often as a photo. Same anatomy, and
              the same reason: a bare `<input type="file">` paints the operating
              system's grey "Choose File / No file chosen" in the *device's*
              language whatever the reader's is. The input is `sr-only` inside
              the `<label>` — never `hidden`, which makes Chrome refuse a submit
              it cannot focus — so what looks like a button *is* the control,
              and the label draws the ring, from `has-[:focus-visible]` so it
              lights for the keyboard as the global ring does. */}
          <div className="flex flex-wrap items-center gap-3">
            <label
              className={buttonClass({
                variant: "secondary",
                size: "sm",
                className: "cursor-pointer has-[:focus-visible]:focus-ring",
              })}
            >
              {picked ? copy.documentChooseAnother : copy.documentChoose}
              <input
                id="medicalClearanceDocument"
                type="file"
                name="medicalClearanceDocument"
                accept="image/*,application/pdf"
                onChange={(event) => setPicked(event.target.files?.[0]?.name ?? null)}
                className="sr-only"
              />
            </label>
            {/* The filename, which is the only half of the native control that
                was ever in the reader's favour — and needs no words of its
                own, so no locale. */}
            {picked ? <span className="min-w-0 truncate text-sm text-muted">{picked}</span> : null}
          </div>
        </Field>
      </FieldGrid>
      <div className="mt-4 flex flex-wrap gap-2">
        <SubmitButton
          pendingLabel={copy.recording}
          className={buttonClass({ variant: "primary", size: "sm" })}
        >
          {copy.confirm}
        </SubmitButton>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className={buttonClass({ variant: "ghost", size: "sm" })}
        >
          {copy.neverMind}
        </button>
      </div>
    </form>
  );
}
