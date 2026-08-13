import type { DiverTranslator } from "@/i18n/messages";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  type PasswordConfirmErrorCode,
} from "@/lib/onboarding";

/**
 * Every code `passwordConfirmSchema` (src/lib/onboarding.ts) can hand back,
 * resolved here — never earlier, since Zod has no request-scoped locale at
 * schema-definition time. Shared by `/invite/[token]` and
 * `/reset-password/[token]`, the two pages that render this schema's `?error=`
 * code (same shape as `ONBOARD_ERROR_MESSAGES` in src/app/onboard/page.tsx).
 */
const PASSWORD_CONFIRM_ERROR_MESSAGES: Record<
  PasswordConfirmErrorCode | "invalid_input",
  (t: DiverTranslator) => string
> = {
  password_too_short: (t) =>
    t("account.common.passwordErrors.tooShort", { min: MIN_PASSWORD_LENGTH }),
  password_too_long: (t) =>
    t("account.common.passwordErrors.tooLong", { max: MAX_PASSWORD_LENGTH }),
  passwords_mismatch: (t) => t("account.common.passwordErrors.mismatch"),
  invalid_input: (t) => t("account.common.passwordErrors.invalid"),
};

/** Resolves a known `?error=` code; anything else gets the generic invalid
 * message. Never the raw query text — `?error=` is attacker-writable, and
 * echoing it hands a phishing link its own copy on our page. */
export function passwordConfirmErrorText(t: DiverTranslator, error: string): string {
  return Object.hasOwn(PASSWORD_CONFIRM_ERROR_MESSAGES, error)
    ? PASSWORD_CONFIRM_ERROR_MESSAGES[error as keyof typeof PASSWORD_CONFIRM_ERROR_MESSAGES](t)
    : PASSWORD_CONFIRM_ERROR_MESSAGES.invalid_input(t);
}

/**
 * Which box the refusal lands on (docs/design/forms-and-controls.md): a
 * length problem names the new-password field, a mismatch names the
 * confirmation, and anything else — including an unknown code — falls back to
 * the form's action row. Keyed by the same `PasswordConfirmErrorCode` union
 * the schema's messages are checked against (`satisfies` in
 * src/lib/onboarding.ts), so a new code can't be added without this map
 * failing to compile. Shared by `/invite/[token]` and
 * `/reset-password/[token]`.
 */
const PASSWORD_CONFIRM_ERROR_FIELDS: Record<
  PasswordConfirmErrorCode,
  "password" | "confirm" | "form"
> = {
  password_too_short: "password",
  password_too_long: "password",
  passwords_mismatch: "confirm",
};

export function passwordConfirmErrorField(error: string): "password" | "confirm" | "form" {
  return Object.hasOwn(PASSWORD_CONFIRM_ERROR_FIELDS, error)
    ? PASSWORD_CONFIRM_ERROR_FIELDS[error as PasswordConfirmErrorCode]
    : "form";
}
