import { createHash, randomBytes } from "node:crypto";
import { DAY_MS, HOUR_MS } from "@/lib/clock";

/**
 * Bearer tokens proving control of a user account's own address — one shape
 * for confirming a freshly created account, another (shorter-lived) for
 * authorizing a password reset (20260725-account-lifecycle-emails), and a
 * third for accepting a staff invite (20260726-staff-invite-accounts). Hashed
 * and expiring like `waiver_records`, not stateless like `recap-links.ts`: a
 * password-reset (or invite-acceptance) token is a credential over account
 * takeover and must be individually revocable.
 */
export type AccountTokenPurpose = "email_verification" | "password_reset" | "invite";

/** Low stakes — only confirms the address works, so a generous window. */
export const EMAIL_VERIFICATION_TTL_MS = 3 * DAY_MS;

/** A live credential over account takeover, so kept short — industry norm. */
export const PASSWORD_RESET_TTL_MS = HOUR_MS;

/**
 * A new hire may not open their inbox the day they're invited, so this is
 * more generous than email verification, but still a hard expiry rather than
 * a link that works forever.
 */
export const INVITE_TTL_MS = 7 * DAY_MS;

export function ttlForAccountTokenPurpose(purpose: AccountTokenPurpose): number {
  if (purpose === "email_verification") return EMAIL_VERIFICATION_TTL_MS;
  if (purpose === "invite") return INVITE_TTL_MS;
  return PASSWORD_RESET_TTL_MS;
}

export function createAccountToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashAccountToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function verifyAccountLinkPath(token: string): string {
  return `/verify/${token}`;
}

export function resetPasswordLinkPath(token: string): string {
  return `/reset-password/${token}`;
}

export function inviteLinkPath(token: string): string {
  return `/invite/${token}`;
}
