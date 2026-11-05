import { DAY_MS, HOUR_MS } from "@/lib/clock";

/**
 * Bearer tokens proving control of a user account's own address — one purpose
 * for confirming a freshly created account, another (shorter-lived) for
 * authorizing a password reset (20260725-account-lifecycle-emails), and a
 * third for accepting a staff invite (20260726-staff-invite-accounts). Each is
 * a `capabilities` row naming the account and no shop, its policy one record
 * in `CAPABILITY_POLICY` (`src/lib/capabilities.ts`, ADR
 * 20261105-capabilities-shop-id-nullable), which reads its time limit from
 * the constants below. Stored as a digest and expiring, not stateless like
 * `recap-links.ts`: a password-reset (or invite-acceptance) token is a
 * credential over account takeover and must be individually revocable.
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

export function verifyAccountLinkPath(token: string): string {
  return `/verify/${token}`;
}

export function resetPasswordLinkPath(token: string): string {
  return `/reset-password/${token}`;
}

export function inviteLinkPath(token: string): string {
  return `/invite/${token}`;
}
