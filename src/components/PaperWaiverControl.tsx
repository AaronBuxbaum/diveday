"use client";

import { useActionState, useEffect, useState } from "react";
import type { PaperWaiverCopy } from "@/components/paper-waiver-copy";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid, FormStatus } from "@/components/ui/form";
import { WaiverActionIcon } from "@/components/WaiverActionIcon";
import {
  PAPER_WAIVER_IDLE,
  type PaperWaiverAction,
  type PaperWaiverFormState,
} from "@/lib/paper-waiver-form";

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
 * on the diver record. An explicit open/cancel pair says what it is.
 *
 * **A refusal answers here rather than navigating** (issue #1674). It used to
 * `redirect()` back with a `?notice=`, which re-rendered the route, remounted
 * these uncontrolled inputs with no defaults, and left the staffer retyping the
 * medical tick, the co-signer's name and the relationship before they could
 * correct the one thing the notice named — at a wet counter, with a family
 * waiting, and worst of all on the namesake refusal, where the confirmation
 * tick only appears on the second pass. So the action returns the typed values
 * beside the refusal instead (`src/lib/paper-waiver-form.ts`) and they come
 * back as the defaults below; the words land in the form's own action row,
 * which is where `.claude/rules/surfaces.md` says a form-level refusal belongs.
 * Success is untouched and still each surface's own business.
 */
export function PaperWaiverControl({
  action,
  bookingId,
  copy,
  requiresGuardian = false,
  offersNamesake = false,
  noticedNamesake = false,
  className = "mt-2",
  variant = "link",
  defaultOpen = false,
}: {
  /**
   * The surface's door onto `recordInPersonWaiver`, already bound to its own
   * arguments. A reducer rather than a plain form action because a refusal
   * hands the typed values back through it — see `PaperWaiverAction`, which
   * exists so a fourth surface cannot quietly pass `(formData) => void` again
   * (that type-checks against `<form action>` and loses every value).
   */
  action: PaperWaiverAction;
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
   * May this surface ever offer the namesake confirmation (issue #1573, owner
   * decision 2026-09-10)? It is drawn only once *this form's own* refusal says
   * the two names matched — so a roster of minors does not all sprout the same
   * tick, and a staffer cannot reach it by typing a URL, which is what the
   * `?notice=`-derived version of this prop allowed.
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
   * **Still a habit fence, not an enforcement.** A request built by hand skips
   * the form entirely. What actually contains the assertion is in the writer:
   * the two names must genuinely match before the tick is honoured at all
   * (`recordInPersonWaiver`), the release records *which* of the two things
   * happened in `guardian_signature_method`, and the staffer who made the
   * assertion is on the row as `recorded_by_person_id`. This prop's job is to
   * keep the checkbox off every ordinary minor's form so it stays an assertion
   * rather than a box people learn to tick.
   */
  offersNamesake?: boolean;
  /**
   * A page-level `?notice=` already said the names matched, before this form
   * was submitted at all — the surface's own reading of its URL, and the one
   * way the tick appears without a refusal of its own (`check-in/page.tsx` and
   * the trip page still route those codes, and the counter's refused-form
   * capture in `e2e/visual.spec.ts` is taken that way). The page renders its
   * own words for it; this only decides whether the way through is drawn.
   *
   * Ignored where `offersNamesake` is off, so no URL reaches the tick on the
   * diver's record.
   */
  noticedNamesake?: boolean;
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
  /**
   * Open on mount — for a page-level notice that landed the staffer back on
   * this form. A refusal of *this* form no longer needs it: nothing navigates,
   * so the panel is already open and stays open.
   */
  defaultOpen?: boolean;
}) {
  const [state, formAction] = useActionState(action, PAPER_WAIVER_IDLE);
  const [open, setOpen] = useState(defaultOpen);
  /**
   * The refusal the staffer backed out of, so "Never mind" really does forget
   * what they typed. Closing unmounts the form, and without this the next open
   * would stand the previous attempt's name and tick back up — on a legal
   * release, a form that quietly remembers is worse than one that forgets.
   * Compared by identity rather than a boolean, so the *next* refusal is a new
   * object and shows through.
   */
  const [dismissed, setDismissed] = useState<PaperWaiverFormState | null>(null);
  const refused = state.status === "refused" && state !== dismissed ? state : null;

  // A page-level notice has to re-open the form even when this component
  // survived the navigation that carried it (the notice arrives as a `?notice=`
  // on the same route, so React may keep the instance and its `useState`
  // initial value is long spent).
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

  const refusal = refused ? copy.refusals[refused.refusal] : null;
  return (
    <form
      action={formAction}
      className={`${className} w-full max-w-md rounded-inset border border-border bg-surface-sunken p-4`}
    >
      {bookingId ? <input type="hidden" name="bookingId" value={bookingId} /> : null}
      <label className="flex items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          name="medicalAttested"
          required
          // React resets an uncontrolled form once its action completes, so a
          // refusal restores these from what it handed back rather than from
          // the DOM, which no longer holds them.
          defaultChecked={refused?.typed.medicalAttested ?? false}
          className="mt-0.5 size-4 shrink-0"
        />
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
              // Echoed exactly as typed, never corrected towards the diver's
              // own name: `personNamesMatch` is deliberately fuzzy, so a
              // pre-fill could change the spelling on a document somebody is
              // attesting to (issue #1674).
              defaultValue={refused?.typed.guardianName ?? ""}
              className={controlClass}
            />
          </Field>
          <Field label={copy.guardian.relationshipLabel}>
            <select
              // **Keyed, unlike the two above it.** React re-applies a changed
              // `defaultValue`/`defaultChecked` to an input, so the form reset
              // that follows an action restores the echoed value there. It does
              // not do the same for a `<select>`: the `selected` attribute
              // stays on whichever option had it at mount, so the reset put
              // this box back on the disabled "choose one" placeholder — and,
              // because it is `required`, the browser then refused the retry
              // the staffer had only one field left to fix. Keying on the value
              // remounts the box so the right option carries `selected`. Both
              // halves are pinned in `PaperWaiverControl.test.tsx`.
              key={refused?.typed.guardianRelationship ?? ""}
              name="guardianRelationship"
              required
              defaultValue={refused?.typed.guardianRelationship ?? ""}
              className={controlClass}
            >
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
      {requiresGuardian &&
      offersNamesake &&
      (noticedNamesake || refused?.refusal === "guardian_name") ? (
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
          onClick={() => {
            setDismissed(state);
            setOpen(false);
          }}
          className={buttonClass({ variant: "ghost", size: "sm" })}
        >
          {copy.neverMind}
        </button>
      </div>
      {/* Beside the button that was just pressed, not in a banner at the top of
          a roster that can run a boat long (`.claude/rules/surfaces.md`). */}
      {refusal ? (
        <FormStatus tone={refusal.tone} className="mt-3">
          {refusal.text}
        </FormStatus>
      ) : null}
    </form>
  );
}
