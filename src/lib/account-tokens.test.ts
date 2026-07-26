import { describe, expect, it } from "vitest";
import {
  createAccountToken,
  EMAIL_VERIFICATION_TTL_MS,
  hashAccountToken,
  PASSWORD_RESET_TTL_MS,
  resetPasswordLinkPath,
  ttlForAccountTokenPurpose,
  verifyAccountLinkPath,
} from "./account-tokens";

describe("account-tokens", () => {
  it("creates distinct, unguessable tokens", () => {
    const a = createAccountToken();
    const b = createAccountToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(20);
  });

  it("hashes deterministically without ever returning the raw token", () => {
    const token = createAccountToken();
    const hash = hashAccountToken(token);
    expect(hash).not.toBe(token);
    expect(hashAccountToken(token)).toBe(hash);
  });

  it("gives email verification a longer TTL than password reset — a live credential over account takeover stays short-lived", () => {
    expect(ttlForAccountTokenPurpose("email_verification")).toBe(EMAIL_VERIFICATION_TTL_MS);
    expect(ttlForAccountTokenPurpose("password_reset")).toBe(PASSWORD_RESET_TTL_MS);
    expect(EMAIL_VERIFICATION_TTL_MS).toBeGreaterThan(PASSWORD_RESET_TTL_MS);
  });

  it("builds the expected link paths", () => {
    expect(verifyAccountLinkPath("abc123")).toBe("/verify/abc123");
    expect(resetPasswordLinkPath("abc123")).toBe("/reset-password/abc123");
  });
});
