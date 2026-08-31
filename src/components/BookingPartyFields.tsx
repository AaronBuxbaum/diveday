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

/**
 * The largest party that still reads as a row of choices rather than a list.
 * Above it the control falls back to the `<select>` — see the comment at the
 * branch below (ADR 20260827-the-divers-thread, decision 2).
 */
const SEGMENTED_PARTY_LIMIT = 6;

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
 *
 * **Steps of one sheet, not boxes inside a box** (ADR
 * 20260827-the-divers-thread, decision 2). Each diver's fieldset used to wear
 * its own `rounded-xl border` inside the booking card's own border, so a party
 * of three read as four nested frames; they are hairline-separated now and the
 * card is the only edge on the page.
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

  const counts = Array.from({ length: limit }, (_, index) => index + 1);
  return (
    <>
      {/* A party of six or fewer is a row of choices a thumb can hit; past that
          it is a list to pick from. `MAX_PUBLIC_PARTY_SIZE` is 20, and a
          twenty-segment track fits no phone at any label size, so the `<select>`
          stays the honest control above the fold-out point (ADR
          20260827-the-divers-thread, decision 2 — the party count as a segmented
          row up to six, falling back to the select). Both shapes carry the same
          accessible name and the same `data-hydrated` flag, so anything asking
          for "Number of divers" finds one element either way. */}
      {limit <= SEGMENTED_PARTY_LIMIT ? (
        <div>
          <p id="party-size-label" className="text-sm font-semibold">
            {t("party.numberOfDivers")}
          </p>
          {/* Deliberately **not** `SegmentedControl`: that one is a row of
              `<Link>`s for moving between routes or views, and a party count is
              a form input whose value has to reach `FormData` and survive a
              refused server parse with everything the diver typed still on
              screen. Radios named `partySize` do that; a navigation control
              cannot. The track's geometry is copied from it so the two read as
              one grammar. */}
          <div
            role="radiogroup"
            aria-labelledby="party-size-label"
            data-hydrated={hydrated ? "true" : "false"}
            className="mt-2 flex w-fit max-w-full flex-wrap gap-1 rounded-2xl border border-border bg-surface-sunken p-1"
          >
            {counts.map((count) => (
              <label
                key={count}
                className={`inline-flex min-h-11 grow cursor-pointer items-center justify-center rounded-xl px-2.5 text-sm font-semibold whitespace-nowrap transition-colors ${
                  size === count
                    ? "bg-surface text-primary shadow-sm"
                    : "text-muted hover:bg-surface hover:text-foreground"
                }`}
              >
                <input
                  type="radio"
                  name="partySize"
                  value={count}
                  checked={size === count}
                  onChange={() => setSize(count)}
                  className="sr-only"
                />
                {t("party.diverCountOption", { count })}
              </label>
            ))}
          </div>
        </div>
      ) : (
        <FieldGrid columns={1} className="max-w-48">
          <Field label={t("party.numberOfDivers")} className="text-base">
            <select
              name="partySize"
              value={size}
              data-hydrated={hydrated ? "true" : "false"}
              onChange={(event) => setSize(Number(event.target.value))}
              className={controlClass}
            >
              {counts.map((count) => (
                <option key={count} value={count}>
                  {t("party.diverCountOption", { count })}
                </option>
              ))}
            </select>
          </Field>
        </FieldGrid>
      )}
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
          // A wrapper carries the hairline rather than the `<fieldset>` itself:
          // a `<legend>` is laid out *in* its fieldset's block-start border,
          // so putting the rule there would leave a gap punched through it
          // exactly where the step's own name sits.
          <div key={slot} className="rise-in border-t border-border pt-4">
            <fieldset>
              <legend className="text-sm font-semibold text-muted">
                {index === 0 ? t("party.yourDetails") : t("party.diverN", { number: index + 1 })}
              </legend>
              {index === 0 && rememberedDiver ? (
                <p className="-mt-1 mb-3 text-sm text-muted">
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
                {index === 0 || !useLeadEmail[index] ? (
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
                      maxLength={200}
                      inputMode="email"
                      autoComplete={index === 0 ? "email" : `section-diver${index} email`}
                      value={member.email}
                      onChange={(event) => updateMember(index, { email: event.target.value })}
                      onBlur={() => setBlurred((current) => ({ ...current, [index]: true }))}
                      className={controlClass}
                    />
                  </Field>
                ) : null}
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
          </div>
        );
      })}
    </>
  );
}
