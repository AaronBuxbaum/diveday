import type { Metadata } from "next";
import Link from "next/link";
import { MarketingFooter } from "@/components/MarketingFooter";
import { MarketingNav } from "@/components/MarketingNav";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { type DiverTranslator, diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { eventSource } from "@/lib/funnel";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, type OnboardErrorCode } from "@/lib/onboarding";
import { onboardAction } from "./actions";

/**
 * Every code `onboardAction`'s `backToForm` can hand back, resolved to a
 * diver-bundle message right here — never earlier. `onboardSchema`'s
 * validation messages are codes for exactly this reason (Zod has no
 * request-scoped locale to translate with at schema-definition time; see
 * src/lib/onboarding.ts), and the rate limiter's rejection is the same kind
 * of code (src/lib/rate-limit.ts). A `?error=` value this map doesn't
 * recognize is one of the handful of business-rule messages in
 * `onboardAction` not yet extracted (shop link taken, email taken, sign-in
 * failure) — those still arrive as plain English and render as-is.
 */
const ONBOARD_ERROR_MESSAGES: Record<
  OnboardErrorCode | "rate_limited" | "invalid_input",
  (t: DiverTranslator) => string
> = {
  rate_limited: (t) => t("common.rateLimited"),
  invalid_input: (t) => t("account.onboard.errors.invalidInput"),
  shop_name_required: (t) => t("account.onboard.errors.shopNameRequired"),
  shop_slug_required: (t) => t("account.onboard.errors.shopSlugRequired"),
  shop_slug_invalid: (t) => t("account.onboard.errors.shopSlugInvalid"),
  timezone_required: (t) => t("account.onboard.errors.timezoneRequired"),
  timezone_invalid: (t) => t("account.onboard.errors.timezoneInvalid"),
  owner_name_required: (t) => t("account.onboard.errors.ownerNameRequired"),
  owner_email_invalid: (t) => t("account.onboard.errors.ownerEmailInvalid"),
  owner_password_too_short: (t) =>
    t("account.onboard.errors.ownerPasswordTooShort", { min: MIN_PASSWORD_LENGTH }),
  owner_password_too_long: (t) =>
    t("account.onboard.errors.ownerPasswordTooLong", { max: MAX_PASSWORD_LENGTH }),
};

/** Resolves a known `?error=` code, or falls back to the raw (English) text of an
 * `onboardAction` message not yet converted to a code. */
function onboardErrorMessage(t: DiverTranslator, error: string): string {
  return Object.hasOwn(ONBOARD_ERROR_MESSAGES, error)
    ? ONBOARD_ERROR_MESSAGES[error as keyof typeof ONBOARD_ERROR_MESSAGES](t)
    : decodeURIComponent(error);
}

export const metadata: Metadata = {
  title: "Start a dive shop trial — DiveDay",
  description:
    "Set up your own DiveDay shop in a few details. No card, no setup fee, and your records download as one ZIP from day one.",
  // Canonical because every marketing page now links here with a `?from=`
  // funnel tag — one page, not nine.
  alternates: { canonical: "/onboard" },
  openGraph: {
    title: "Start a dive shop trial — DiveDay",
    description:
      "A few details and you're looking at your own working shop. No card, no setup fee.",
    url: "/onboard",
  },
};

export default async function OnboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; from?: string }>;
}) {
  const { error, from } = await searchParams;
  // Which marketing page's "Start a trial" sent them here; the action reads it
  // back off the form for the trial_started funnel event.
  const source = eventSource(from);
  const t = diverTranslator(await requestLocale());

  /**
   * The reassurance a shop owner needs at the moment they're being asked for a
   * password by a vendor they'd never heard of an hour ago. Every line is a
   * shipped, checkable fact — no card field exists, the export button works on
   * day one, and the founder-direct line is an authorized founding-shop term.
   */
  const reassurance = [
    {
      lead: t("account.onboard.reassurance.noCard.lead"),
      body: t("account.onboard.reassurance.noCard.body"),
    },
    {
      lead: t("account.onboard.reassurance.yourRecords.lead"),
      body: t("account.onboard.reassurance.yourRecords.body"),
    },
    {
      lead: t("account.onboard.reassurance.founderLine.lead"),
      body: t("account.onboard.reassurance.founderLine.body"),
    },
  ] as const;

  return (
    <div className="flex flex-1 flex-col">
      <MarketingNav />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 px-6 py-12 sm:py-24">
        <div className="rounded-lg border border-border bg-surface p-6 sm:p-8 shadow-sm">
          <p className="text-xs font-semibold tracking-widest text-primary uppercase">
            {t("account.onboard.eyebrow")}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            {t("account.onboard.title")}
          </h1>
          <p className="mt-1.5 text-sm text-muted">{t("account.onboard.description")}</p>

          {error ? (
            <p role="alert" className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
              {onboardErrorMessage(t, error)}
            </p>
          ) : null}

          <form action={onboardAction} className="mt-6 flex flex-col gap-5">
            <input type="hidden" name="source" value={source} />
            <section className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold border-b border-border pb-1">
                {t("account.onboard.shopSectionTitle")}
              </h2>
              <FieldGrid columns={2}>
                <Field label={t("account.onboard.shopNameLabel")}>
                  <input
                    name="shopName"
                    type="text"
                    required
                    placeholder={t("account.onboard.shopNamePlaceholder")}
                    className={controlClass}
                  />
                </Field>
                <Field label={t("account.onboard.shopLinkLabel")}>
                  <input
                    name="shopSlug"
                    type="text"
                    required
                    placeholder={t("account.onboard.shopLinkPlaceholder")}
                    pattern="^[a-z0-9-]+$"
                    title={t("account.onboard.shopLinkTitle")}
                    className={controlClass}
                  />
                </Field>
              </FieldGrid>
              <FieldGrid columns={1}>
                <Field label={t("account.onboard.timezoneLabel")}>
                  <select
                    name="timezone"
                    required
                    defaultValue="America/New_York"
                    className={controlClass}
                  >
                    <option value="America/New_York">
                      {t("account.onboard.timezone.eastern")}
                    </option>
                    <option value="America/Chicago">{t("account.onboard.timezone.central")}</option>
                    <option value="America/Denver">{t("account.onboard.timezone.mountain")}</option>
                    <option value="America/Los_Angeles">
                      {t("account.onboard.timezone.pacific")}
                    </option>
                    <option value="Europe/London">{t("account.onboard.timezone.london")}</option>
                    <option value="Asia/Singapore">
                      {t("account.onboard.timezone.singapore")}
                    </option>
                    <option value="Australia/Sydney">{t("account.onboard.timezone.sydney")}</option>
                    <option value="Pacific/Auckland">
                      {t("account.onboard.timezone.auckland")}
                    </option>
                  </select>
                </Field>
              </FieldGrid>
            </section>

            <section className="flex flex-col gap-4 mt-2">
              <h2 className="text-lg font-semibold border-b border-border pb-1">
                {t("account.onboard.youSectionTitle")}
              </h2>
              <FieldGrid columns={1}>
                <Field label={t("account.onboard.fullNameLabel")}>
                  <input
                    name="ownerName"
                    type="text"
                    required
                    placeholder={t("account.onboard.fullNamePlaceholder")}
                    className={controlClass}
                  />
                </Field>
              </FieldGrid>
              <FieldGrid columns={2}>
                <Field label={t("account.common.email")}>
                  <input
                    name="ownerEmail"
                    type="email"
                    required
                    placeholder={t("account.onboard.emailPlaceholder")}
                    className={controlClass}
                  />
                </Field>
                <Field label={t("account.common.password")}>
                  <input
                    name="ownerPassword"
                    type="password"
                    required
                    placeholder={t("account.onboard.passwordPlaceholder")}
                    minLength={8}
                    maxLength={72}
                    className={controlClass}
                  />
                </Field>
              </FieldGrid>
            </section>

            <ul className="mt-2 flex flex-col gap-3 rounded-lg border border-border bg-surface-sunken p-4">
              {reassurance.map((item) => (
                <li key={item.lead} className="flex gap-3 text-sm leading-6 text-muted">
                  <span aria-hidden className="font-semibold text-primary">
                    ✓
                  </span>
                  <span>
                    <span className="font-semibold text-foreground">{item.lead}</span> {item.body}
                  </span>
                </li>
              ))}
            </ul>

            <p className="text-xs text-muted">
              {t("account.onboard.exploreNote")}{" "}
              <Link href="/" className="text-primary font-medium hover:underline">
                {t("account.onboard.tryLiveDemo")}
              </Link>
              .
            </p>

            <SubmitButton
              pendingLabel={t("account.onboard.settingUp")}
              className={buttonClass({ className: "mt-2" })}
            >
              {t("account.onboard.submit")}
            </SubmitButton>
          </form>

          <p className="text-center text-sm text-muted mt-6">
            {t("account.onboard.alreadyHaveShop")}{" "}
            <Link href="/sign-in" className="text-primary font-medium hover:underline">
              {t("account.onboard.signIn")}
            </Link>
          </p>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
