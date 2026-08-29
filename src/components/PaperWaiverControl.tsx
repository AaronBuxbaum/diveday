"use client";

import { useEffect, useState } from "react";
import type { PaperWaiverCopy } from "@/components/paper-waiver-copy";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { WaiverActionIcon } from "@/components/WaiverActionIcon";

/**
 * "This diver signed on paper" — the escape hatch for a signature the app
 * never sees, on every staff surface that can be held up by a missing waiver.
 *
 * The medical attestation is a required checkbox naming what the staffer is
 * asserting, not a buried confirm: `recordInPersonWaiver` refuses without it,
 * and a flagged medical answer must go through the diver-facing link, which
 * captures the questionnaire and routes it to review. The result is the same
 * immutable completed record a self-service signature produces, marked
 * `in_person_attested` and stamped with the staff member who attested.
 *
 * One component rather than a per-surface copy: the roster grew this control
 * first, and the check-in counter — where a diver is standing in front of you
 * holding the paper — had no way to record it at all.
 *
 * It was a `<details>` until 2026-08-20, which is why it is a Client Component
 * now. A disclosure triangle is a *reading* affordance — "there is more text
 * here" — and this is a two-field form with a real refusal, so the native
 * summary gave it a caret nobody asked for, no way to back out once open, and a
 * trigger that could never sit level with the sibling actions it belongs beside
 * on the diver record. An explicit open/cancel pair says what it is, and
 * `defaultOpen` lets a refused submit come back with the form still standing
 * rather than collapsed over its own error.
 */
export function PaperWaiverControl({
  action,
  bookingId,
  copy,
  className = "mt-2",
  variant = "link",
  defaultOpen = false,
}: {
  // i18n-exempt: type annotation, not copy.
  action: (formData: FormData) => void | Promise<void>;
  /**
   * The seat this was recorded from, on the two surfaces that have one. Omitted
   * on the diver's own record, where the subject is the person in the URL — the
   * record is the same either way (ADR 20260811-person-scoped-paper-waivers).
   */
  bookingId?: string;
  copy: PaperWaiverCopy;
  className?: string;
  /**
   * Genuinely different jobs, not skins. Under a primary "send the link"
   * action this is the fallback — `ghost` keeps it in quiet ink (the trip
   * roster; `link`'s teal read louder than the bordered send pill above it —
   * design review 2026-08-29). On the diver record it is one of four peer
   * ways to get a release signed, so `secondary` lets it stand level with
   * the other three.
   */
  variant?: "link" | "secondary" | "ghost";
  /** Open on mount — for a refusal landing back on the form that produced it. */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  // A fresh refusal has to re-open the form even when this component survived
  // the navigation that carried it (the notice arrives as a `?notice=` on the
  // same route, so React may keep the instance and its `useState` initial value
  // is long spent).
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);

  // No wrapper element in either state: on the diver record this control is one
  // item of a wrapping flex row of peer actions, and a wrapper would take the
  // trigger out of that row. The open panel is `w-full` so it drops onto its own
  // line there, and reads as the plain `max-w-md` box everywhere else.
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
        {copy.markSignedOnPaper}
      </button>
    );
  }

  return (
    <form
      action={action}
      className={`${className} w-full max-w-md rounded-xl border border-border bg-surface-sunken p-4`}
    >
      {bookingId ? <input type="hidden" name="bookingId" value={bookingId} /> : null}
      <label className="flex items-start gap-2.5 text-sm">
        <input type="checkbox" name="medicalAttested" required className="mt-0.5 size-4 shrink-0" />
        <span>{copy.medicalAttestationLabel}</span>
      </label>
      <div className="mt-4 flex flex-wrap gap-2">
        <SubmitButton
          pendingLabel={copy.recording}
          className={buttonClass({ variant: "primary", size: "sm" })}
        >
          {copy.recordPaperSignature}
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
