import { createHash, randomBytes } from "node:crypto";

/**
 * Bearer tokens proving control of a user account's own address — one shape
 * for confirming a freshly created account, another (shorter-lived) for
 * authorizing a password reset (20260725-account-lifecycle-emails). Hashed
 * and expiring like `waiver_records`, not stateless like `recap-links.ts`: a
 * password-reset token is a credential over account takeover and must be
 * individually revocable.
 */
export type AccountTokenPurpose = "email_verification" | "password_reset";

/** Low stakes — only confirms the address works, so a generous window. */
export const EMAIL_VERIFICATION_TTL_MS = 3 * 24 * 60 * 60 * 1000;

/** A live credential over account takeover, so kept short — industry norm. */
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

export function ttlForAccountTokenPurpose(purpose: AccountTokenPurpose): number {
  return purpose === "email_verification" ? EMAIL_VERIFICATION_TTL_MS : PASSWORD_RESET_TTL_MS;
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
