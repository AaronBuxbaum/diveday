import type { DiverTranslator } from "@/i18n/messages";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, type OnboardErrorCode } from "@/lib/onboarding";

/**
 * Every code `onboardAction`'s `backToForm` can hand back, resolved to a
 * diver-bundle message right here — never earlier. `onboardSchema`'s
 * validation messages are codes for exactly this reason (Zod has no
 * request-scoped locale to translate with at schema-definition time; see
 * src/lib/onboarding.ts), and the rate limiter's rejection and the action's
 * business-rule refusals (shop link taken, email taken, create/sign-in
 * failure) are the same kind of code. Every path is covered: an unknown
 * `?error=` value falls back to the generic invalid-input message rather
 * than echoing a raw string.
 */
const ONBOARD_ERROR_MESSAGES: Record<
  | OnboardErrorCode
  | "rate_limited"
  | "invalid_input"
  | "shop_slug_taken"
  | "email_taken"
  | "email_reserved"
  | "create_failed"
  | "signin_failed",
  (t: DiverTranslator, ctx: { shopSlug?: string }) => string
> = {
  rate_limited: (t) => t("common.rateLimited"),
  invalid_input: (t) => t("account.onboard.errors.invalidInput"),
  shop_slug_taken: (t, ctx) =>
    t("account.onboard.errors.shopSlugTaken", { slug: ctx.shopSlug ?? "" }),
  email_taken: (t) => t("account.onboard.errors.emailTaken"),
  // The reserved demo namespace (`*.demo.invalid`) — never routable, so never
  // a real owner's address (ADR 20260803-demo-bypass-containment).
  email_reserved: (t) => t("account.onboard.errors.emailReserved"),
  create_failed: (t) => t("account.onboard.errors.createFailed"),
  signin_failed: (t) => t("account.onboard.errors.signinFailed"),
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

/**
 * Resolves a known `?error=` code. Anything unrecognized gets the generic
 * invalid-input message: every real code is in the map, so an unknown value is
 * a stale link or a hand-edited URL, and echoing it back would both leak raw
 * strings into the page and bypass the bundle.
 */
export function onboardErrorMessage(
  t: DiverTranslator,
  error: string,
  ctx: { shopSlug?: string },
): string {
  return Object.hasOwn(ONBOARD_ERROR_MESSAGES, error)
    ? ONBOARD_ERROR_MESSAGES[error as keyof typeof ONBOARD_ERROR_MESSAGES](t, ctx)
    : t("account.onboard.errors.invalidInput");
}

/**
 * Which box each refusal lands on (docs/design/forms-and-controls.md): a slug
 * problem names the shop-link field, a taken email names the email field, and
 * only the codes about the submission as a whole (rate limit, create/sign-in
 * failure) fall back to the form's action row. An unknown code is form-level,
 * like the generic message it resolves to.
 */
const ONBOARD_ERROR_FIELDS: Record<
  keyof typeof ONBOARD_ERROR_MESSAGES,
  "shopName" | "shopSlug" | "timezone" | "ownerName" | "ownerEmail" | "ownerPassword" | "form"
> = {
  rate_limited: "form",
  invalid_input: "form",
  shop_slug_taken: "shopSlug",
  email_taken: "ownerEmail",
  email_reserved: "ownerEmail",
  create_failed: "form",
  signin_failed: "form",
  shop_name_required: "shopName",
  shop_slug_required: "shopSlug",
  shop_slug_invalid: "shopSlug",
  timezone_required: "timezone",
  timezone_invalid: "timezone",
  owner_name_required: "ownerName",
  owner_email_invalid: "ownerEmail",
  owner_password_too_short: "ownerPassword",
  owner_password_too_long: "ownerPassword",
};

export function onboardErrorField(
  error: string,
): (typeof ONBOARD_ERROR_FIELDS)[keyof typeof ONBOARD_ERROR_FIELDS] {
  return Object.hasOwn(ONBOARD_ERROR_FIELDS, error)
    ? ONBOARD_ERROR_FIELDS[error as keyof typeof ONBOARD_ERROR_FIELDS]
    : "form";
}
