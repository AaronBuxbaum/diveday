"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { mailtoHref, telHref } from "@/lib/contact-links";
import { suggestEmailTypo } from "@/lib/email-typo";
import { loadReturningDiver, type ReturningDiver } from "@/lib/returning-diver";
import { MAX_PUBLIC_PARTY_SIZE } from "@/lib/trips";

// **One slot per bookable seat, derived rather than listed.** This was a
// six-name tuple, which silently became the real cap the moment
// MAX_PUBLIC_PARTY_SIZE rose above it: the select offered twenty, `slice(0,
// size)` rendered six, and a party of nine submitted three blank names for
// boxes that were never on screen (caught in review of issue #725). Deriving
// it means the form and the validator cannot disagree about how many divers a
// booking holds.
//
// The values are only React keys, and they are stable per position — which is
// all the comment at the `key=` below asks for: raising the party size mounts
// the newly-added fieldsets and leaves the ones already on screen alone, so
// `rise-in` plays for what just appeared.
const diverSlots = Array.from({ length: MAX_PUBLIC_PARTY_SIZE }, (_, index) => `diver-${index}`);

type PartyMember = { fullName: string; email: string };

const emptyMember: PartyMember = { fullName: "", email: "" };

/** Per-input error keyed by the field's form name, e.g. `email-0` or `phone`. */
export type BookingFieldErrors = Record<string, string>;

/**
 * The party editor for booking and waitlist forms. Controlled so a failed
 * server parse re-renders with everything the diver typed still in place
 * (the audit's "six divers' names, gone" was the redirect throwing it away).
 *
 * Email is the diver's only lifeline — confirmation, waiver, readiness link —
 * so it carries `autoComplete`/`inputMode` for autofill and a one-tap "did you
 * mean gmail.com?" correction. The nudge never blocks: the form submits
 * whatever was typed regardless.
 *
 * **Names and addresses, and nothing about anyone's diving.** A per-diver
 * certification question lived here between 2026-08-20 and 2026-08-27; it now
 * belongs to `/ready/<token>`, which asks the diver whose booking it is rather
 * than whoever filled the anonymous form (see `BookSpotSection`).
 */
export function BookingPartyFields({
  maxPartySize,
  leadPhone = false,
  fieldErrors,
  remember = false,
  onSizeChange,
  contactEmail,
  contactPhone,
}: {
  maxPartySize: number;
  /** Show an optional phone field for the lead booker (diver 1). */
  leadPhone?: boolean;
  fieldErrors?: BookingFieldErrors;
  /** Prefill the lead diver from a previous booking on this device (task 27
   * — Marco). Never in the embed widget; the caller decides that. */
  remember?: boolean;
  /** Told every time the diver-selected party size changes (including on
   * mount), so a caller can show its own party-size-dependent content (task
   * 18's running total). Pass a stable reference (`useState`'s setter, not
   * an inline arrow) — this fires from an effect keyed on it. */
  onSizeChange?: (size: number) => void;
  /** The shop's own contact, for the "bigger group?" escape hatch (task 24)
   * below the party-size field. Either or both may be null when the shop
   * hasn't set one. */
  contactEmail?: string | null;
  contactPhone?: string | null;
}) {
  const t = useTranslations();
  const [size, setSize] = useState(1);
  const [hydrated, setHydrated] = useState(false);
  const [party, setParty] = useState<PartyMember[]>(() =>
    Array.from({ length: MAX_PUBLIC_PARTY_SIZE }, () => ({ ...emptyMember })),
  );
  const [phone, setPhone] = useState("");
  const [blurred, setBlurred] = useState<Record<number, boolean>>({});
  const [rememberedDiver, setRememberedDiver] = useState<ReturningDiver | null>(null);
  // Per-member (index > 0 only): "use the main contact's email instead of
  // typing one" (task 21) — Priya's kids don't each need their own address.
  // The field is simply left out of the submission when checked (a disabled
  // input never lands in FormData), so the booking transaction takes the
  // same no-email walk-in path a counter booking already uses — a fresh
  // person row with no email, never a second row sharing the lead's address
  // (which would collide with it as "already booked" the moment a second
  // member opted in — see src/db/bookings.ts and its "rolls back the whole
  // party" test).
  const [useLeadEmail, setUseLeadEmail] = useState<Record<number, boolean>>({});
  const limit = Math.max(1, Math.min(MAX_PUBLIC_PARTY_SIZE, maxPartySize));
  useEffect(() => setHydrated(true), []);
  useEffect(() => onSizeChange?.(size), [size, onSizeChange]);

  function updateMember(index: number, patch: Partial<PartyMember>) {
    setParty((current) => current.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: only ever applied once on mount
  useEffect(() => {
    if (!remember) return;
    const stored = loadReturningDiver();
    if (!stored) return;
    setRememberedDiver(stored);
    updateMember(0, { fullName: stored.fullName, email: stored.email });
  }, [remember]);

  function forgetRememberedDiver() {
    setRememberedDiver(null);
    updateMember(0, { fullName: "", email: "" });
  }

  return (
    <>
      <FieldGrid columns={1} className="max-w-48">
        <Field label={t("party.numberOfDivers")} className="text-base">
          <select
            name="partySize"
            value={size}
            data-hydrated={hydrated ? "true" : "false"}
            onChange={(event) => setSize(Number(event.target.value))}
            className={controlClass}
          >
            {Array.from({ length: limit }, (_, index) => index + 1).map((count) => (
              <option key={count} value={count}>
                {t("party.diverCountOption", { count })}
              </option>
            ))}
          </select>
        </Field>
      </FieldGrid>
      {/* The select tops out at `limit` (either MAX_PUBLIC_PARTY_SIZE or
          however many seats remain) — a bigger group has no way to book itself
          here, so it needs an explicit way out rather than a dead end at the
          last option (task 24). */}
      {limit < MAX_PUBLIC_PARTY_SIZE ? (
        <p className="-mt-2 text-sm text-muted">
          {contactEmail
            ? t.rich("party.bigGroupContactEmail", {
                count: limit,
                contact: contactEmail,
                a: (chunks) => (
                  <a
                    href={mailtoHref(contactEmail)}
                    className="font-medium text-primary hover:underline"
                  >
                    {chunks}
                  </a>
                ),
              })
            : contactPhone
              ? t.rich("party.bigGroupContactPhone", {
                  count: limit,
                  contact: contactPhone,
                  a: (chunks) => (
                    <a
                      href={telHref(contactPhone)}
                      className="font-medium text-primary hover:underline"
                    >
                      {chunks}
                    </a>
                  ),
                })
              : t("party.bigGroupContactGeneric", { count: limit })}
        </p>
      ) : null}
      {diverSlots.slice(0, size).map((slot, index) => {
        const member = party[index] ?? emptyMember;
        const nameError = fieldErrors?.[`fullName-${index}`];
        const emailError = fieldErrors?.[`email-${index}`];
        const suggestion = blurred[index] ? suggestEmailTypo(member.email) : null;
        return (
          // Keyed by a stable slot name, so raising the party size only mounts
          // the newly-added fieldsets — `rise-in`'s entrance plays for those,
          // not the ones already on screen, explaining what just changed
          // instead of the page silently jumping taller (design/principles.md #5).
          <fieldset key={slot} className="rise-in rounded-xl border border-border p-4">
            <legend className="px-1 text-sm font-semibold text-muted">
              {index === 0 ? t("party.yourDetails") : t("party.diverN", { number: index + 1 })}
            </legend>
            {index === 0 && rememberedDiver ? (
              <p className="-mt-1 mb-3 px-1 text-sm text-muted">
                {t.rich("party.rememberedChip", {
                  name: rememberedDiver.fullName,
                  strong: (chunks) => (
                    <strong className="font-semibold text-foreground">{chunks}</strong>
                  ),
                  button: (chunks) => (
                    <button
                      type="button"
                      onClick={forgetRememberedDiver}
                      className="font-medium text-primary hover:underline"
                    >
                      {chunks}
                    </button>
                  ),
                })}
              </p>
            ) : null}
            <FieldGrid columns={2}>
              <Field
                label={
                  index === 0
                    ? t("party.nameLabel")
                    : t("party.diverNameLabel", { number: index + 1 })
                }
                className="text-base"
                error={nameError}
              >
                <input
                  name={`fullName-${index}`}
                  required
                  maxLength={120}
                  // Every slot gets a real autofill token (task 22) — a
                  // browser scopes repeated `name`/`email` tokens per
                  // fieldset via `section-*`, so diver 2's autofill offer
                  // never collides with diver 1's. `autoComplete="off"` here
                  // used to suppress that entirely for every diver past the
                  // first, which is exactly the friction Priya hits typing
                  // three names by hand on a phone.
                  autoComplete={index === 0 ? "name" : `section-diver${index} name`}
                  value={member.fullName}
                  onChange={(event) => updateMember(index, { fullName: event.target.value })}
                  className={controlClass}
                />
              </Field>
              <Field
                label={
                  index === 0
                    ? t("party.emailLabel")
                    : t("party.diverEmailLabel", { number: index + 1 })
                }
                className="text-base"
                error={emailError}
                description={
                  suggestion ? (
                    <button
                      type="button"
                      onClick={() => updateMember(index, { email: suggestion })}
                      className="justify-self-start text-xs font-medium text-primary hover:underline"
                    >
                      {t("party.didYouMeanEmail", { email: suggestion })}
                    </button>
                  ) : undefined
                }
              >
                <input
                  name={`email-${index}`}
                  type="email"
                  required={index === 0 || !useLeadEmail[index]}
                  disabled={index > 0 && useLeadEmail[index]}
                  maxLength={200}
                  inputMode="email"
                  autoComplete={index === 0 ? "email" : `section-diver${index} email`}
                  value={member.email}
                  onChange={(event) => updateMember(index, { email: event.target.value })}
                  onBlur={() => setBlurred((current) => ({ ...current, [index]: true }))}
                  className={controlClass}
                />
              </Field>
              {index > 0 ? (
                <label className="flex min-h-11 items-center gap-2 text-sm text-muted sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={!!useLeadEmail[index]}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setUseLeadEmail((current) => ({ ...current, [index]: checked }));
                      if (checked) updateMember(index, { email: "" });
                    }}
                    className="size-4"
                  />
                  {t("party.useMainContactEmail")}
                </label>
              ) : null}
              {index === 0 && leadPhone ? (
                <Field
                  label={t("party.phoneLabel")}
                  hint={t("party.phoneHint")}
                  className="text-base sm:col-span-2"
                  error={fieldErrors?.phone}
                >
                  <input
                    name="phone"
                    type="tel"
                    maxLength={30}
                    autoComplete="tel"
                    inputMode="tel"
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
