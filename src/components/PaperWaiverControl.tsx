"use client";

import { useEffect, useState } from "react";
import type { PaperWaiverCopy } from "@/components/paper-waiver-copy";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
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
  requiresGuardian = false,
  offerNamesake = false,
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
  /**
   * The diver is a minor today, so the paper release names its co-signer too
   * (ADR 20260907-guardian-co-signature). `recordInPersonWaiver` applies the
   * same rule from the date of birth on file and refuses without one, so this
   * only decides whether the two controls are drawn — a staffer never meets
   * the refusal, and a hand-built request never gets past it.
   */
  requiresGuardian?: boolean;
  /**
   * Draw the namesake confirmation under the guardian fields (issue #1573,
   * owner decision 2026-09-10). Set only on the form that has already been
   * refused for it — each surface reads its own `?notice=waiver-guardian-name`
   * and scopes it to the booking or record the refusal named, so a roster of
   * minors does not all sprout the same tick.
   *
   * **Two surfaces set it, and the diver record is deliberately not one of
   * them.** The checkbox says, in the first person, that the staffer watched
   * two people sign; the counter queue and the trip roster are the doors a
   * diver is standing at, and the diver record is documented as the absentee
   * case (`InPersonWaiverSubject` in `src/db/waivers.ts` — "they phoned ahead,
   * or handed the release over months before they book anything"). Offering
   * the tick to somebody reading a scanned PDF asks them to attest to a thing
   * nobody witnessed, and `in_person_attested_namesake` exists to tell a
   * regulator that somebody did (`dive-domain-expert`, issue #1453).
   *
   * **That scoping is a habit fence, not an enforcement.** `?notice=` is
   * untrusted input on both surfaces, so a staffer can reach a form with this
   * drawn by typing a URL, and a request built by hand skips the form
   * entirely. What actually contains the assertion is in the writer: the two
   * names must genuinely match before the tick is honoured at all
   * (`recordInPersonWaiver`), the release records *which* of the two things
   * happened in `guardian_signature_method`, and the staffer who made the
   * assertion is on the row as `recorded_by_person_id`. This prop's job is to
   * keep the checkbox off every ordinary minor's form so it stays an
   * assertion rather than a box people learn to tick.
   */
  offerNamesake?: boolean;
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
      className={`${className} w-full max-w-md rounded-inset border border-border bg-surface-sunken p-4`}
    >
      {bookingId ? <input type="hidden" name="bookingId" value={bookingId} /> : null}
      <label className="flex items-start gap-2.5 text-sm">
        <input type="checkbox" name="medicalAttested" required className="mt-0.5 size-4 shrink-0" />
        <span>{copy.medicalAttestationLabel}</span>
      </label>
      {/* A minor's paper release was signed twice, so the record names both
          (ADR 20260907-guardian-co-signature). The staffer attests to the
          guardian's signature the way they attest to the diver's — same
          `in_person_attested` evidence, same act. */}
      {requiresGuardian ? (
        <FieldGrid columns={2} className="mt-4">
          <Field label={copy.guardian.nameLabel}>
            <input
              name="guardianName"
              autoComplete="off"
              required
              minLength={2}
              maxLength={120}
              className={controlClass}
            />
          </Field>
          <Field label={copy.guardian.relationshipLabel}>
            <select name="guardianRelationship" required defaultValue="" className={controlClass}>
              <option value="" disabled>
                {copy.guardian.relationshipChoose}
              </option>
              {copy.guardian.relationshipOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
        </FieldGrid>
      ) : null}
      {/* The one way past the namesake refusal, and only here (ADR
          20260907-guardian-co-signature, decision 10). It is an assertion
          about what this staffer saw, not a confirmation of an intent, so it
          reads as a sentence in the first person like the medical attestation
          above it — and it is never `required`: a family who reached this form
          by any other refusal still submits without it. */}
      {requiresGuardian && offerNamesake ? (
        <label className="mt-4 flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            name="guardianNamesakeAttested"
            className="mt-0.5 size-4 shrink-0"
          />
          <span>{copy.guardian.namesakeLabel}</span>
        </label>
      ) : null}
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
