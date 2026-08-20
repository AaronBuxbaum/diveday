// i18n-exempt-file: type-only action signature; all visible labels arrive as translated props.
"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/form";

type ReviewAction = (formData: FormData) => void | Promise<void>;

export function ReviewHideForm({
  reviewId,
  action,
  reasons,
  reasonLabel,
  reasonPlaceholder,
  noteLabel,
  hideLabel,
  savingLabel,
}: {
  reviewId: string;
  action: ReviewAction;
  reasons: readonly { value: string; label: string }[];
  reasonLabel: string;
  reasonPlaceholder: string;
  noteLabel: string;
  hideLabel: string;
  savingLabel: string;
}) {
  const [reason, setReason] = useState("");

  return (
    <form action={action} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="reviewId" value={reviewId} />
      <input type="hidden" name="publish" value="false" />
      <label className="text-xs font-medium text-muted" htmlFor={`reason-${reviewId}`}>
        {reasonLabel}
      </label>
      <select
        id={`reason-${reviewId}`}
        name="reason"
        required
        defaultValue=""
        onChange={(event) => setReason(event.target.value)}
        className={controlClass}
      >
        <option value="" disabled>
          {reasonPlaceholder}
        </option>
        {reasons.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {reason === "other" ? (
        <input
          name="reasonNote"
          type="text"
          maxLength={200}
          required
          aria-label={noteLabel}
          className={controlClass}
        />
      ) : null}
      <SubmitButton pendingLabel={savingLabel} className={buttonClass({ variant: "secondary" })}>
        {hideLabel}
      </SubmitButton>
    </form>
  );
}
