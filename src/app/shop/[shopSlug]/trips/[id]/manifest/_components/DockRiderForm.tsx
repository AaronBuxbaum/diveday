"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { CompactDisclosureRow } from "@/components/ui/disclosure";
import { controlClass, Field, FieldActions, FieldGrid, FormStatus } from "@/components/ui/form";
import { fill } from "@/i18n/fill";
import type { DockRiderState } from "../dock-rider-actions";

export type DockRiderCopy = {
  door: string;
  name: string;
  phone: string;
  optional: string;
  emergencyName: string;
  emergencyPhone: string;
  submit: string;
  pending: string;
  /** A template: `{name}` is filled here with whoever was just added. */
  added: string;
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
 * **Add somebody who turned up at the boat to ride along** (batch 4, D6). A
 * quiet disclosure under the crew list: it is the rare case at the rail, and
 * the roll call above it stays the page's subject. Riders only — a diver who
 * walks on goes through the desk, where the certification checks are.
 */
export function DockRiderForm({
  action,
  copy,
}: {
  action: (state: DockRiderState | undefined, formData: FormData) => Promise<DockRiderState>;
  copy: DockRiderCopy;
}) {
  const [state, formAction] = useActionState(action, undefined);
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
        key={state?.status === "added" ? state.name : "form"}
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
        <FieldActions>
          <SubmitButton
            pendingLabel={copy.pending}
            className={buttonClass({ variant: "secondary" })}
          >
            {copy.submit}
          </SubmitButton>
          {state?.status === "added" ? (
            <FormStatus tone="success">{fill(copy.added, { name: state.name })}</FormStatus>
          ) : state?.status === "refused" ? (
            <FormStatus>{refusalText(copy, state.reason)}</FormStatus>
          ) : null}
        </FieldActions>
      </FieldGrid>
    </CompactDisclosureRow>
  );
}
