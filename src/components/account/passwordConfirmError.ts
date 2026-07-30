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

/** Resolves a known `?error=` code, or falls back to the raw text of an
 * unrecognized value rather than rendering nothing. */
export function passwordConfirmErrorText(t: DiverTranslator, error: string): string {
  return Object.hasOwn(PASSWORD_CONFIRM_ERROR_MESSAGES, error)
    ? PASSWORD_CONFIRM_ERROR_MESSAGES[error as keyof typeof PASSWORD_CONFIRM_ERROR_MESSAGES](t)
    : decodeURIComponent(error);
}
