import { z } from "zod";
import { isValidTimeZone } from "./format";

/**
 * Framework-free so it can be unit-tested without pulling in next-auth (which
 * needs a Next.js server runtime). `src/app/onboard/actions.ts`,
 * `src/app/invite/[token]/actions.ts`, and
 * `src/app/reset-password/[token]/actions.ts` all set a new password against
 * these same bounds. bcrypt (via bcryptjs) silently truncates at 72 bytes: a
 * longer password would appear accepted but only its first 72 bytes are ever
 * checked, which is worse than rejecting it outright. 8 is a deliberate
 * minimum, not the old bare "6 characters" (CR-014).
 */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 72;

/**
 * Every message a "set a password, confirm it" form can attach to a failed
 * field, as a stable code — never English prose (same reasoning as
 * `OnboardErrorCode` below: Zod wants a message at schema-definition time,
 * before any request-scoped locale is known). Shared by `/invite/[token]` and
 * `/reset-password/[token]`, the two flows that ask for a fresh password and
 * its confirmation with no other fields.
 */
export type PasswordConfirmErrorCode =
  | "password_too_short"
  | "password_too_long"
  | "passwords_mismatch";

export const passwordConfirmSchema = z
  .object({
    password: z
      .string()
      .min(MIN_PASSWORD_LENGTH, "password_too_short" satisfies PasswordConfirmErrorCode)
      .max(MAX_PASSWORD_LENGTH, "password_too_long" satisfies PasswordConfirmErrorCode),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "passwords_mismatch" satisfies PasswordConfirmErrorCode,
    path: ["confirmPassword"],
  });

/**
 * Every message `onboardSchema` can attach to a failed field, as a stable
 * code — never English prose. Zod wants a message string at schema-definition
 * time, before any request-scoped locale is known, so the schema can't call a
 * translator itself; `src/app/onboard/page.tsx` maps each code through
 * `ONBOARD_ERROR_KEYS` into the diver bundle right before render (the same
 * shape as every other domain-layer code in this codebase — see
 * `ERROR_MESSAGE_KEYS` in the trips/[id] booking flow).
 */
export type OnboardErrorCode =
  | "shop_name_required"
  | "shop_slug_required"
  | "shop_slug_invalid"
  | "timezone_required"
  | "timezone_invalid"
  | "owner_name_required"
  | "owner_email_invalid"
  | "owner_password_too_short"
  | "owner_password_too_long";

/** The slug field's own bound, shared with `suggestShopSlug` so a suggestion
 * can never overflow what `onboardSchema` accepts. */
export const MAX_SHOP_SLUG_LENGTH = 50;

/**
 * The shop link a shop's name implies — "Green Lagoon Divers" →
 * "green-lagoon-divers". Inventing a URL is the one moment in sign-up where a
 * shop owner has to stop and *decide* something; this turns it into watching
 * the link write itself (they can still edit it — a suggestion, never a
 * decision made for them, same posture as `DetectTimezone`).
 *
 * Diacritics fold to their base letter (Café → cafe) via NFKD so a shop named
 * in Spanish or French gets a readable link rather than one with letters
 * silently dropped. Anything else outside `[a-z0-9]` collapses to a single
 * hyphen, and the result always satisfies `onboardSchema`'s slug rule — or is
 * empty, for a name with no usable characters, which callers treat as "no
 * suggestion".
 */
export function suggestShopSlug(shopName: string): string {
  return shopName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SHOP_SLUG_LENGTH)
    .replace(/-+$/, "");
}

export const onboardSchema = z.object({
  shopName: z
    .string()
    .trim()
    .min(1, "shop_name_required" satisfies OnboardErrorCode)
    .max(100),
  shopSlug: z
    .string()
    .trim()
    .min(1, "shop_slug_required" satisfies OnboardErrorCode)
    .max(MAX_SHOP_SLUG_LENGTH)
    .toLowerCase()
    .regex(/^[a-z0-9-]+$/, "shop_slug_invalid" satisfies OnboardErrorCode),
  timezone: z
    .string()
    .trim()
    .min(1, "timezone_required" satisfies OnboardErrorCode)
    .refine(isValidTimeZone, "timezone_invalid" satisfies OnboardErrorCode),
  ownerName: z
    .string()
    .trim()
    .min(1, "owner_name_required" satisfies OnboardErrorCode)
    .max(100),
  ownerEmail: z
    .string()
    .trim()
    .email("owner_email_invalid" satisfies OnboardErrorCode)
    .max(150),
  ownerPassword: z
    .string()
    .min(MIN_PASSWORD_LENGTH, "owner_password_too_short" satisfies OnboardErrorCode)
    .max(MAX_PASSWORD_LENGTH, "owner_password_too_long" satisfies OnboardErrorCode),
});

/**
 * How many steps the first-run checklist has
 * (`src/app/shop/[shopSlug]/_components/today/FirstRunChecklist.tsx`).
 *
 * Interpolated into the subtitle rather than spelled in the copy: it read "Five
 * steps and divers can start booking" while the list grew a sixth (issue #712),
 * and a hard-coded count in a message bundle is a fact nobody holds to the
 * component that produces it. `FirstRunChecklist.test.tsx` counts the rendered
 * steps against this, which is what actually keeps them in step.
 *
 * Here rather than beside the component because that component is `"use
 * client"`: a server component importing a plain value from a client module
 * gets a client *reference*, and the subtitle rendered "NaN steps" — green in
 * every test, wrong on the screen.
 */
export const FIRST_RUN_STEP_COUNT = 6;
