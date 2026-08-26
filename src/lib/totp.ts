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

export function totpCode(secret: string, timestampMs = nowMs(), stepSeconds = 30): string {
  const counter = Math.floor(timestampMs / 1000 / stepSeconds);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 15;
  const value = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(value % 1_000_000).padStart(6, "0");
}

export function verifyTotpCode(secret: string, code: string, timestampMs = nowMs()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const expected = totpCode(secret, timestampMs);
  return timingSafeEqual(Buffer.from(expected), Buffer.from(code));
}

export function recoveryCodeHashes(codes: readonly string[]): string[] {
  return codes.map((code) => createHmac("sha256", "diveday-recovery").update(code).digest("hex"));
}

export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => base32Encode(randomBytes(7)).slice(0, 10));
}
