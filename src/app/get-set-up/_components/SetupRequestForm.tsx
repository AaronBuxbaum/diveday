"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { FieldErrorFocus } from "@/components/ui/FieldErrorFocus";
import { ChoicePill, controlClass, Field, FieldGrid, FormStatus } from "@/components/ui/form";
import {
  SETUP_CURRENT_SYSTEMS,
  SETUP_HONEYPOT_FIELD,
  SETUP_PHONE_MAX,
  SETUP_TEXT_MAX,
  type SetupCurrentSystem,
  type SetupField,
  type SetupFieldError,
} from "@/lib/setup-requests";
import { submitSetupRequestAction } from "../actions";

/** Every word the form shows, resolved on the server in the reader's language. */
export type SetupRequestFormWords = {
  shopName: string;
  region: string;
  runsBoat: string;
  yes: string;
  no: string;
  currentSystem: string;
  current: Record<SetupCurrentSystem, string>;
  contactName: string;
  email: string;
  phone: string;
  website: string;
  submit: string;
  sending: string;
  errors: { required: string; invalid: string; email: string };
  rateLimited: string;
};

/**
 * The set-up request form (ADR 20261007-setup-request-form). A Client
 * Component only so a refusal can answer in place with everything the reader
 * typed still in the boxes; a stored request redirects to the thank-you page.
 *
 * Seven asks, one optional (the phone), in the order a first set-up call takes
 * them: the shop, where it is, whether it runs a boat, what it runs on now,
 * then who to write back to. The two choice questions are pills, not selects:
 * two and five short answers read faster laid out than folded away.
 *
 * The honeypot sits off screen, out of the tab order and hidden from
 * assistive technology, so only a bot ever fills it (`SETUP_HONEYPOT_FIELD`).
 */
export function SetupRequestForm({
  source,
  words,
}: {
  /** The funnel tag the door carried, already clamped by `eventSource`. */
  source: string;
  words: SetupRequestFormWords;
}) {
  const [state, formAction] = useActionState(submitSetupRequestAction, {});
  const values = state.values ?? {};
  const errorFor = (field: SetupField): string | undefined => {
    const code: SetupFieldError | undefined = state.fieldErrors?.[field];
    if (!code) return undefined;
    if (code === "required") return words.errors.required;
    return field === "email" ? words.errors.email : words.errors.invalid;
  };
  // React resets an uncontrolled form once its action settles; keying on the
  // answer makes every field re-read the values the action handed back.
  const formKey = JSON.stringify(state);

  return (
    <form key={formKey} action={formAction} className="flex flex-col gap-5">
      {state.fieldErrors ? <FieldErrorFocus key={formKey} /> : null}
      <input type="hidden" name="source" value={source} />
      <div aria-hidden="true" className="absolute -start-[10000px] h-px w-px overflow-hidden">
        <label>
          {words.website}
          <input type="text" name={SETUP_HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <FieldGrid columns={1} className="gap-y-5">
        <Field label={words.shopName} error={errorFor("shopName")}>
          <input
            name="shopName"
            type="text"
            required
            maxLength={SETUP_TEXT_MAX}
            autoComplete="organization"
            defaultValue={values.shopName}
            className={controlClass}
          />
        </Field>
        <Field label={words.region} error={errorFor("region")}>
          <input
            name="region"
            type="text"
            required
            maxLength={SETUP_TEXT_MAX}
            autoComplete="address-level2"
            defaultValue={values.region}
            className={controlClass}
          />
        </Field>
        <Field label={words.runsBoat} group error={errorFor("runsBoat")}>
          <div className="flex gap-3">
            {(["yes", "no"] as const).map((answer) => (
              <ChoicePill
                key={answer}
                type="radio"
                size="md"
                name="runsBoat"
                value={answer}
                required
                defaultChecked={values.runsBoat === answer}
                className="flex-1"
              >
                {words[answer]}
              </ChoicePill>
            ))}
          </div>
        </Field>
        <Field label={words.currentSystem} group error={errorFor("currentSystem")}>
          <div className="grid gap-2 sm:grid-cols-2">
            {SETUP_CURRENT_SYSTEMS.map((system) => (
              <ChoicePill
                key={system}
                type="radio"
                size="md"
                name="currentSystem"
                value={system}
                required
                defaultChecked={values.currentSystem === system}
              >
                {words.current[system]}
              </ChoicePill>
            ))}
          </div>
        </Field>
        <Field label={words.contactName} error={errorFor("contactName")}>
          <input
            name="contactName"
            type="text"
            required
            maxLength={SETUP_TEXT_MAX}
            autoComplete="name"
            defaultValue={values.contactName}
            className={controlClass}
          />
        </Field>
        <Field label={words.email} error={errorFor("email")}>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            defaultValue={values.email}
            className={controlClass}
          />
        </Field>
        <Field label={words.phone} error={errorFor("phone")}>
          <input
            name="phone"
            type="tel"
            maxLength={SETUP_PHONE_MAX}
            autoComplete="tel"
            defaultValue={values.phone}
            className={controlClass}
          />
        </Field>
      </FieldGrid>
      <div className="flex flex-col gap-3">
        <SubmitButton pendingLabel={words.sending} className={buttonClass({ className: "w-full" })}>
          {words.submit}
        </SubmitButton>
        <FormStatus>{state.formError === "rate_limited" ? words.rateLimited : null}</FormStatus>
      </div>
    </form>
  );
}
