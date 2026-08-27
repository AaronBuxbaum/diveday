import { describe, expect, it } from "vitest";
import {
  base32Encode,
  generateRecoveryCodes,
  matchTotpStep,
  normalizeRecoveryCode,
  recoveryCodeHashes,
  totpCode,
  TOTP_STEP_SECONDS,
  verifyTotpCode,
} from "./totp";

/**
 * RFC 6238 Appendix B's SHA-1 vectors, which every authenticator app is built
 * against. The RFC prints eight digits; a six-digit code is the low six of the
 * same number, so these are the same answers truncated the way this app
 * truncates them. Without a vector, "the code my phone shows" and "the code
 * this file computes" are two claims nothing ever compares.
 */
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));
const RFC_VECTORS: Array<[seconds: number, eightDigits: string]> = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
];

describe("totpCode", () => {
  it("matches the RFC 6238 SHA-1 test vectors an authenticator app implements", () => {
    for (const [seconds, eightDigits] of RFC_VECTORS) {
      expect(totpCode(RFC_SECRET, seconds * 1000)).toBe(eightDigits.slice(-6));
    }
  });

  it("holds one code for the whole 30-second step and changes at the boundary", () => {
    const start = 1_700_000_000_000 - (1_700_000_000_000 % (TOTP_STEP_SECONDS * 1000));
    expect(totpCode(RFC_SECRET, start)).toBe(totpCode(RFC_SECRET, start + 29_000));
    expect(totpCode(RFC_SECRET, start)).not.toBe(totpCode(RFC_SECRET, start + 30_000));
  });
});

describe("matchTotpStep", () => {
  const now = 1_700_000_040_000;
  const step = Math.floor(now / 1000 / TOTP_STEP_SECONDS);

  it("accepts the current code and reports the step it belongs to", () => {
    expect(matchTotpStep(RFC_SECRET, totpCode(RFC_SECRET, now), now)).toBe(step);
  });

  /** A phone's clock and a server's are never identical (RFC 6238 s5.2). */
  it("accepts one step of drift either side, and reports that step, not now", () => {
    const previous = totpCode(RFC_SECRET, now - TOTP_STEP_SECONDS * 1000);
    const next = totpCode(RFC_SECRET, now + TOTP_STEP_SECONDS * 1000);
    expect(matchTotpStep(RFC_SECRET, previous, now)).toBe(step - 1);
    expect(matchTotpStep(RFC_SECRET, next, now)).toBe(step + 1);
  });

  it("refuses a code two steps away", () => {
    const stale = totpCode(RFC_SECRET, now - 2 * TOTP_STEP_SECONDS * 1000);
    expect(matchTotpStep(RFC_SECRET, stale, now)).toBeNull();
  });

  it("refuses a wrong code, a wrong secret, and anything that is not six digits", () => {
    expect(matchTotpStep(RFC_SECRET, "000000", now)).toBeNull();
    const other = base32Encode(Buffer.from("09876543210987654321", "ascii"));
    expect(matchTotpStep(RFC_SECRET, totpCode(other, now), now)).toBeNull();
    for (const bad of ["", "12345", "1234567", "abcdef", "12 345", "١٢٣٤٥٦"]) {
      expect(matchTotpStep(RFC_SECRET, bad, now)).toBeNull();
    }
  });

  it("verifyTotpCode agrees with it", () => {
    expect(verifyTotpCode(RFC_SECRET, totpCode(RFC_SECRET, now), now)).toBe(true);
    expect(verifyTotpCode(RFC_SECRET, "000000", now)).toBe(false);
  });
});

describe("generateRecoveryCodes", () => {
  it("creates codes accepted by the setup form", () => {
    const codes = generateRecoveryCodes(10);

    expect(codes).toHaveLength(10);
    expect(codes.every((code) => /^[A-Z2-7]{10}$/.test(code))).toBe(true);
  });

  it("does not repeat itself", () => {
    expect(new Set(generateRecoveryCodes(50)).size).toBe(50);
  });
});

describe("recoveryCodeHashes", () => {
  const key = "a-deployment-sealing-key";
  const codes = ["ABCDEFGHIJ"];

  /**
   * The key used to be the literal string "diveday-recovery" compiled into the
   * source, which is a plain hash wearing an HMAC's clothes.
   */
  it("changes completely with the deployment key", () => {
    expect(recoveryCodeHashes(codes, key, "account-1")[0]).not.toBe(
      recoveryCodeHashes(codes, "a-different-key", "account-1")[0],
    );
  });

  /** Without the salt, one leaked digest is checkable against every account. */
  it("gives two accounts different digests for the same code", () => {
    expect(recoveryCodeHashes(codes, key, "account-1")[0]).not.toBe(
      recoveryCodeHashes(codes, key, "account-2")[0],
    );
  });

  it("is stable, and reads a code the way it comes off paper", () => {
    const canonical = recoveryCodeHashes(["ABCDEFGHIJ"], key, "account-1")[0];
    for (const typed of ["abcdefghij", "  ABCDEFGHIJ  ", "ABCDE-FGHIJ", "ABCDE FGHIJ"]) {
      expect(recoveryCodeHashes([typed], key, "account-1")[0]).toBe(canonical);
    }
  });

  it("normalizes the same way on its own", () => {
    expect(normalizeRecoveryCode(" abcde-fghij ")).toBe("ABCDEFGHIJ");
  });
});
