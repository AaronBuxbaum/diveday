"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { CompactDisclosureRow } from "@/components/ui/disclosure";
import {
  ChoiceFieldset,
  ChoicePill,
  controlClass,
  Field,
  FieldActions,
  FieldGrid,
  FormStatus,
} from "@/components/ui/form";
import { fill } from "@/i18n/fill";
import type { DockRiderState } from "../dock-rider-actions";

export type DockRiderCopy = {
  door: string;
  name: string;
  phone: string;
  optional: string;
  emergencyName: string;
  emergencyPhone: string;
  dateOfBirth: string;
  aboardAs: string;
  ridesAlong: string;
  snorkels: string;
  submit: string;
  pending: string;
  /** Templates: `{name}` is filled here with whoever was just added. */
  added: string;
  addedOwesRelease: string;
  /** The hand-over when no email took the release: sign on paper, or here. */
  releaseHandOver: string;
  openRelease: string;
  owesPayment: string;
  owesOther: string;
  refusals: {
    trip_full: string;
    trip_unavailable: string;
    participant_type_unavailable: string;
    departed: string;
    already_aboard: string;
    invalid: string;
    other: string;
  };
};

function refusalText(copy: DockRiderCopy, reason: string): string {
  return Object.hasOwn(copy.refusals, reason)
    ? copy.refusals[reason as keyof DockRiderCopy["refusals"]]
    : copy.refusals.other;
}

/**
 * **Add somebody who turned up at the boat** (batch 4, D6). A quiet disclosure
 * under the crew list: it is the rare case at the rail, and the roll call
 * above it stays the page's subject. Riding along or snorkeling only — a diver
 * who walks on goes through the desk, where the certification checks are.
 *
 * A seat is not boarding: the notice says what they still owe before the rail
 * takes them (the release, payment), and where the release can be signed
 * right here, on the crew's own phone.
 */
export function DockRiderForm({
  action,
  copy,
}: {
  action: (state: DockRiderState | undefined, formData: FormData) => Promise<DockRiderState>;
  copy: DockRiderCopy;
}) {
  const [state, formAction] = useActionState(action, undefined);
  const added = state?.status === "added" ? state : null;
  return (
    <CompactDisclosureRow
      id="dock-rider"
      label={copy.door}
      holdOpen={state ? true : undefined}
      className="scroll-mt-24"
    >
      {/* Keyed on the last success so the fields empty after an add and stay
          filled after a refusal, for the crew to correct. */}
      <FieldGrid
        as="form"
        action={formAction}
        columns={2}
        key={added ? added.bookingId : "form"}
        data-testid="dock-rider-form"
      >
        <Field label={copy.name}>
          <input
            name="fullName"
            required
            maxLength={120}
            autoComplete="off"
            className={controlClass}
          />
        </Field>
        <Field label={copy.phone} hint={copy.optional}>
          <input
            name="phone"
            type="tel"
            maxLength={40}
            autoComplete="off"
            className={controlClass}
          />
        </Field>
        <Field label={copy.emergencyName}>
          <input
            name="emergencyContactName"
            required
            maxLength={120}
            autoComplete="off"
            className={controlClass}
          />
        </Field>
        <Field label={copy.emergencyPhone}>
          <input
            name="emergencyContactPhone"
            type="tel"
            required
            maxLength={40}
            autoComplete="off"
            className={controlClass}
          />
        </Field>
        <Field label={copy.dateOfBirth} hint={copy.optional}>
          <input name="dateOfBirth" type="date" className={controlClass} />
        </Field>
        <ChoiceFieldset legend={copy.aboardAs}>
          <div className="flex flex-wrap gap-2">
            <ChoicePill type="radio" name="participantType" value="rider" defaultChecked>
              {copy.ridesAlong}
            </ChoicePill>
            <ChoicePill type="radio" name="participantType" value="snorkeler">
              {copy.snorkels}
            </ChoicePill>
          </div>
        </ChoiceFieldset>
        <FieldActions>
          <SubmitButton
            pendingLabel={copy.pending}
            className={buttonClass({ variant: "secondary" })}
          >
            {copy.submit}
          </SubmitButton>
          {added ? (
            <FormStatus tone={added.owes.length === 0 ? "success" : "warning"}>
              {fill(added.owes.includes("release") ? copy.addedOwesRelease : copy.added, {
                name: added.name,
              })}
              {added.owes.includes("release") && added.waiverPath ? (
                <>
                  {" "}
                  {copy.releaseHandOver}{" "}
                  <a href={added.waiverPath} target="_blank" rel="noreferrer" className="underline">
                    {copy.openRelease}
                  </a>
                </>
              ) : null}
              {added.owes.includes("payment") ? ` ${copy.owesPayment}` : null}
              {added.owes.includes("other") ? ` ${copy.owesOther}` : null}
            </FormStatus>
          ) : state?.status === "refused" ? (
            <FormStatus>{refusalText(copy, state.reason)}</FormStatus>
          ) : null}
        </FieldActions>
      </FieldGrid>
    </CompactDisclosureRow>
  );
}
