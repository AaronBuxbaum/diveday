import { z } from "zod";
import { isValidTimeZone } from "./format";

/**
 * Framework-free so it can be unit-tested without pulling in next-auth (which
 * needs a Next.js server runtime) — src/app/onboard/actions.ts is the only
 * caller. bcrypt (via bcryptjs) silently truncates at 72 bytes: a longer
 * password would appear accepted but only its first 72 bytes are ever
 * checked, which is worse than rejecting it outright. 8 is a deliberate
 * minimum, not the old bare "6 characters" (CR-014).
 */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 72;

/**
 * Every message `onboardSchema` can attach to a failed field, as a stable
 * code — never English prose. Zod wants a message string at schema-definition
 * time, before any request-scoped locale is known, so the schema can't call a
 * translator itself; `src/app/onboard/page.tsx` maps each code through
 * `ONBOARD_ERROR_KEYS` into the diver bundle right before render (the same
 * shape as every other domain-layer code in this codebase — see
 * `ERROR_MESSAGE_KEYS` in the schedule/[id] booking flow).
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
    .max(50)
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
