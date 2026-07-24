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

export const onboardSchema = z.object({
  shopName: z.string().trim().min(1, "Shop name is required").max(100),
  shopSlug: z
    .string()
    .trim()
    .min(1, "Slug is required")
    .max(50)
    .toLowerCase()
    .regex(/^[a-z0-9-]+$/, "Slug must only contain letters, numbers, and hyphens"),
  timezone: z
    .string()
    .trim()
    .min(1, "Timezone is required")
    .refine(isValidTimeZone, "Not a recognized timezone"),
  ownerName: z.string().trim().min(1, "Owner name is required").max(100),
  ownerEmail: z.string().trim().email("Invalid email address").max(150),
  ownerPassword: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
    .max(MAX_PASSWORD_LENGTH, `Password must be at most ${MAX_PASSWORD_LENGTH} characters`),
});
