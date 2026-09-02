"use client";

import { useEffect, useState } from "react";
import type { MedicalClearanceCopy } from "@/components/medical-clearance-copy";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { Field } from "@/components/ui/form";
import { WaiverActionIcon } from "@/components/WaiverActionIcon";

/**
 * **"A physician cleared this diver" — the one door out of a medical hold.**
 *
 * The questionnaire refers a diver, the release parks in review, and readiness
 * refuses to board them. The diver then comes back with a signed physician
 * evaluation, and before this there was nowhere to put it: the only lift was
 * the paper-waiver attestation, whose checkbox says *no answer needs physician
 * sign-off* — the opposite of what the diver is holding (issue #1252).
 *
 * So it is a separate control from `PaperWaiverControl`, and shaped the same
 * way for the same reasons: an explicit open/cancel pair rather than a
 * `<details>`, and `defaultOpen` so a refusal comes back with the form still
 * standing instead of collapsed over its own error.
 *
 * **No attestation checkbox.** The paper control has one because a staffer is
 * asserting something about a form the app never saw; here the assertion *is*
 * the act, and the button says it. A second box to tick would be ceremony over
 * a decision already made — and the accountable staff member is recorded either
 * way. The document is optional because a shop that files the paper in a
 * cabinet still needs the fact on the record.
 */
export function MedicalClearanceControl({
  action,
  copy,
  className = "mt-2",
  variant = "secondary",
  defaultOpen = false,
}: {
  // i18n-exempt: type annotation, not copy.
  action: (formData: FormData) => void | Promise<void>;
  copy: MedicalClearanceCopy;
  className?: string;
  variant?: "link" | "secondary" | "ghost";
  /** Open on mount — for a refusal landing back on the form that produced it. */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

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
      <Field label={copy.documentLabel} hint={copy.documentHint} htmlFor="medicalClearanceDocument">
        <input
          id="medicalClearanceDocument"
          type="file"
          name="medicalClearanceDocument"
          accept="image/*,application/pdf"
          className="text-sm"
        />
      </Field>
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
