import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { nowMs } from "@/lib/clock";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let buffer = 0;
  let bits = 0;
  let output = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(buffer << (5 - bits)) & 31];
  return output;
}

export function base32Decode(value: string): Buffer {
  let buffer = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const char of value.toUpperCase().replaceAll("=", "").replaceAll(" ", "")) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error("invalid base32");
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function createTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpCode(
  secret: string,
  timestampMs = nowMs(),
  stepSeconds = TOTP_STEP_SECONDS,
): string {
  return totpCodeForStep(secret, totpStepAt(timestampMs, stepSeconds));
}

function totpCodeForStep(secret: string, counter: number): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 15;
  const value = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(value % 1_000_000).padStart(6, "0");
}

/**
 * How many 30-second steps either side of now are accepted. RFC 6238 s5.2 asks
 * for exactly this: a phone's clock and a server's are never identical, and a
 * code typed as the window turns is a code the user read correctly. Verifying
 * only the current step rejected both, which reads as "your authenticator is
 * broken" -- and the replay guard below, not a narrow window, is what stops a
 * seen code being reused.
 */
export const TOTP_DRIFT_STEPS = 1;
export const TOTP_STEP_SECONDS = 30;

export function totpStepAt(timestampMs: number, stepSeconds = TOTP_STEP_SECONDS): number {
  return Math.floor(timestampMs / 1000 / stepSeconds);
}

/**
 * The time step `code` is valid for, or null. Returns the step rather than a
 * boolean so the caller can record *which* one it spent: with drift accepted,
 * "the current step" is no longer the same thing as "the step this code was
 * for", and consuming the wrong one would leave the real one replayable.
 */
export function matchTotpStep(
  secret: string,
  code: string,
  timestampMs = nowMs(),
  driftSteps = TOTP_DRIFT_STEPS,
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = totpStepAt(timestampMs);
  const supplied = Buffer.from(code);
  let matched: number | null = null;
  // Every candidate is compared, and compared in constant time, so neither the
  // number of comparisons nor the time they take says which step hit.
  for (let offset = -driftSteps; offset <= driftSteps; offset++) {
    const step = current + offset;
    const expected = Buffer.from(totpCodeForStep(secret, step));
    if (timingSafeEqual(expected, supplied) && matched === null) matched = step;
  }
  return matched;
}

export function verifyTotpCode(secret: string, code: string, timestampMs = nowMs()): boolean {
  return matchTotpStep(secret, code, timestampMs) !== null;
}

/**
 * Hashes a recovery code for storage.
 *
 * `key` is the deployment's own sealing key and `userAccountId` is the salt.
 * Both matter: the key used to be the literal string "diveday-recovery",
 * compiled into this file, which is a hash wearing an HMAC's clothes -- anyone
 * holding the source could rebuild the table. And without the per-account
 * salt, two accounts issued the same code stored the same digest, so a leaked
 * hash was checkable against every account at once.
 */
export function recoveryCodeHashes(
  codes: readonly string[],
  key: Buffer | string,
  userAccountId: string,
): string[] {
  return codes.map((code) =>
    createHmac("sha256", key)
      .update(`${userAccountId}\u0000${normalizeRecoveryCode(code)}`)
      .digest("hex"),
  );
}

/** A recovery code is read off paper, so spacing and case are the reader's. */
export function normalizeRecoveryCode(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .replaceAll(/[\s-]+/gu, "");
}

export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => base32Encode(randomBytes(7)).slice(0, 10));
}
