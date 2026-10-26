"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { FieldErrorFocus } from "@/components/ui/FieldErrorFocus";
import { ChoicePill, controlClass, Field, FieldGrid, FormStatus } from "@/components/ui/form";
import {
  asksWhichSystem,
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
  notSpecified: string;
  current: Record<SetupCurrentSystem, string>;
  whichSystem: string;
  anotherSystem: string;
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
 * Contact and shop details come first. The phone and current tool are optional;
 * an unanswered tool stays unanswered through validation and storage.
 *
 * **"Which one?"** (2026-10-22) follows "A booking system" or "Dive-shop
 * software", and only those: the systems with a switching guide, and
 * "Another one". Optional, so a system with no guide never blocks a request.
 * A reader who came from a guide's door finds that system already answered
 * (`preselect`), until they answer otherwise.
 *
 * The honeypot sits off screen, out of the tab order and hidden from
 * assistive technology, so only a bot ever fills it (`SETUP_HONEYPOT_FIELD`).
 */
export function SetupRequestForm({
  source,
  words,
  systems,
  preselect,
}: {
  /** The funnel tag the door carried, already clamped by `eventSource`. */
  source: string;
  words: SetupRequestFormWords;
  /** The systems "Which one?" offers: each switching guide's slug and name. */
  systems: readonly { slug: string; name: string }[];
  /** The answers a switching guide's door starts the form with. */
  preselect?: {
    currentSystem: SetupCurrentSystem;
    currentSystemGuide: string;
  } | null;
}) {
  const [state, formAction] = useActionState(submitSetupRequestAction, {});
  // What the reader typed wins once there is any; until then, the door's answers.
  const values: Partial<Record<SetupField, string>> = state.values ?? preselect ?? {};
  const [picked, setPicked] = useState<string | null>(null);
  const asksWhich = asksWhichSystem(picked ?? values.currentSystem);
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
        <Field label={words.runsBoat} group required error={errorFor("runsBoat")}>
          <div className="grid grid-cols-2 gap-2">
            {(["yes", "no"] as const).map((answer) => (
              <ChoicePill
                key={answer}
                type="radio"
                size="md"
                name="runsBoat"
                value={answer}
                required
                defaultChecked={values.runsBoat === answer}
              >
                {words[answer]}
              </ChoicePill>
            ))}
          </div>
        </Field>
        <Field label={words.currentSystem} error={errorFor("currentSystem")}>
          <select
            name="currentSystem"
            defaultValue={values.currentSystem ?? ""}
            onChange={(event) => setPicked(event.target.value)}
            className={controlClass}
          >
            <option value="">{words.notSpecified}</option>
            {SETUP_CURRENT_SYSTEMS.map((system) => (
              <option key={system} value={system}>
                {words.current[system]}
              </option>
            ))}
          </select>
        </Field>
        {asksWhich ? (
          <Field label={words.whichSystem} group>
            <div className="grid grid-cols-2 gap-2">
              {[
                ...systems.map(({ slug, name }) => [slug, name] as const),
                ["", words.anotherSystem] as const,
              ].map(([slug, name]) => (
                <ChoicePill
                  key={slug}
                  type="radio"
                  size="md"
                  name="currentSystemGuide"
                  value={slug}
                  defaultChecked={slug !== "" && values.currentSystemGuide === slug}
                >
                  {name}
                </ChoicePill>
              ))}
            </div>
          </Field>
        ) : null}
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
