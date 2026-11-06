import { describe, expect, it } from "vitest";
import {
  EMAIL_VERIFICATION_TTL_MS,
  INVITE_TTL_MS,
  inviteLinkPath,
  PASSWORD_RESET_TTL_MS,
  resetPasswordLinkPath,
  verifyAccountLinkPath,
} from "./account-tokens";
import { CAPABILITY_POLICY } from "./capabilities";

describe("account-tokens", () => {
  it("gives email verification a longer TTL than password reset — a live credential over account takeover stays short-lived", () => {
    expect(CAPABILITY_POLICY.email_verification.ttlMs).toBe(EMAIL_VERIFICATION_TTL_MS);
    expect(CAPABILITY_POLICY.password_reset.ttlMs).toBe(PASSWORD_RESET_TTL_MS);
    expect(CAPABILITY_POLICY.invite.ttlMs).toBe(INVITE_TTL_MS);
    expect(EMAIL_VERIFICATION_TTL_MS).toBeGreaterThan(PASSWORD_RESET_TTL_MS);
  });

  it("lets a reset live a day and an invite a month: single-use and superseded by a resend either way", () => {
    expect(PASSWORD_RESET_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(INVITE_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("builds the expected link paths", () => {
    expect(verifyAccountLinkPath("abc123")).toBe("/verify/abc123");
    expect(resetPasswordLinkPath("abc123")).toBe("/reset-password/abc123");
    expect(inviteLinkPath("abc123")).toBe("/invite/abc123");
  });
});
