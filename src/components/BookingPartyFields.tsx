"use client";

import { useEffect, useState } from "react";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { suggestEmailTypo } from "@/lib/email-typo";

const diverSlots = ["one", "two", "three", "four", "five", "six"] as const;

type PartyMember = { fullName: string; email: string };

const emptyMember: PartyMember = { fullName: "", email: "" };

/** Per-input error keyed by the field's form name, e.g. `email-0` or `phone`. */
export type BookingFieldErrors = Record<string, string>;

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <span id={id} className="text-xs font-normal text-danger">
      {message}
    </span>
  );
}

/**
 * The party editor for booking and waitlist forms. Controlled so a failed
 * server parse re-renders with everything the diver typed still in place
 * (the audit's "six divers' names, gone" was the redirect throwing it away).
 *
 * Email is the diver's only lifeline — confirmation, waiver, readiness link —
 * so it carries `autoComplete`/`inputMode` for autofill and a one-tap "did you
 * mean gmail.com?" correction. The nudge never blocks: the form submits
 * whatever was typed regardless.
 */
export function BookingPartyFields({
  maxPartySize,
  leadPhone = false,
  fieldErrors,
}: {
  maxPartySize: number;
  /** Show an optional phone field for the lead booker (diver 1). */
  leadPhone?: boolean;
  fieldErrors?: BookingFieldErrors;
}) {
  const [size, setSize] = useState(1);
  const [hydrated, setHydrated] = useState(false);
  const [party, setParty] = useState<PartyMember[]>(() =>
    Array.from({ length: 6 }, () => ({ ...emptyMember })),
  );
  const [phone, setPhone] = useState("");
  const [blurred, setBlurred] = useState<Record<number, boolean>>({});
  const limit = Math.max(1, Math.min(6, maxPartySize));
  useEffect(() => setHydrated(true), []);

  function updateMember(index: number, patch: Partial<PartyMember>) {
    setParty((current) => current.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  }

  return (
    <>
      <FieldGrid columns={1} className="max-w-48">
        <Field label="Number of divers" className="text-base">
          <select
            name="partySize"
            value={size}
            data-hydrated={hydrated ? "true" : "false"}
            onChange={(event) => setSize(Number(event.target.value))}
            className={controlClass}
          >
            {Array.from({ length: limit }, (_, index) => index + 1).map((count) => (
              <option key={count} value={count}>
                {count} {count === 1 ? "diver" : "divers"}
              </option>
            ))}
          </select>
        </Field>
      </FieldGrid>
      {diverSlots.slice(0, size).map((slot, index) => {
        const member = party[index] ?? emptyMember;
        const nameError = fieldErrors?.[`fullName-${index}`];
        const emailError = fieldErrors?.[`email-${index}`];
        const suggestion = blurred[index] ? suggestEmailTypo(member.email) : null;
        return (
          <fieldset key={slot} className="rounded-xl border border-border p-4">
            <legend className="px-1 text-sm font-semibold text-muted">
              {index === 0 ? "Your details" : `Diver ${index + 1}`}
            </legend>
            <FieldGrid columns={2}>
              <Field
                label={index === 0 ? "Name" : `Diver ${index + 1} name`}
                className="text-base"
                description={<FieldError id={`fullName-${index}-error`} message={nameError} />}
              >
                <input
                  name={`fullName-${index}`}
                  required
                  maxLength={120}
                  autoComplete={index === 0 ? "name" : "off"}
                  aria-invalid={nameError ? "true" : undefined}
                  aria-describedby={nameError ? `fullName-${index}-error` : undefined}
                  value={member.fullName}
                  onChange={(event) => updateMember(index, { fullName: event.target.value })}
                  className={controlClass}
                />
              </Field>
              <Field
                label={index === 0 ? "Email" : `Diver ${index + 1} email`}
                className="text-base"
                description={
                  <>
                    <FieldError id={`email-${index}-error`} message={emailError} />
                    {suggestion ? (
                      <button
                        type="button"
                        onClick={() => updateMember(index, { email: suggestion })}
                        className="justify-self-start text-xs font-medium text-primary hover:underline"
                      >
                        Did you mean {suggestion}?
                      </button>
                    ) : null}
                  </>
                }
              >
                <input
                  name={`email-${index}`}
                  type="email"
                  required
                  maxLength={200}
                  inputMode="email"
                  autoComplete={index === 0 ? "email" : "off"}
                  aria-invalid={emailError ? "true" : undefined}
                  aria-describedby={emailError ? `email-${index}-error` : undefined}
                  value={member.email}
                  onChange={(event) => updateMember(index, { email: event.target.value })}
                  onBlur={() => setBlurred((current) => ({ ...current, [index]: true }))}
                  className={controlClass}
                />
              </Field>
              {index === 0 && leadPhone ? (
                <Field
                  label="Phone"
                  hint="(if the crew needs to reach you)"
                  className="text-base sm:col-span-2"
                  description={<FieldError id="phone-error" message={fieldErrors?.phone} />}
                >
                  <input
                    name="phone"
                    type="tel"
                    maxLength={30}
                    autoComplete="tel"
                    inputMode="tel"
                    aria-invalid={fieldErrors?.phone ? "true" : undefined}
                    aria-describedby={fieldErrors?.phone ? "phone-error" : undefined}
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    className={controlClass}
                  />
                </Field>
              ) : null}
            </FieldGrid>
          </fieldset>
        );
      })}
    </>
  );
}
