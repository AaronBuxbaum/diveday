import { nowDate } from "@/lib/clock";
import { openSecret, sealSecret, secretKeyFromEnvironment } from "@/lib/secret-box";

const PREFIX = "counter_";
const PURPOSE = "counter-waiver-v1";

/** Refuse before issuing anything when the deployment cannot seal the QR. */
export function counterWaiverSealingAvailable(): boolean {
  return secretKeyFromEnvironment().status === "ok";
}

/** A purpose-bound envelope never exposes the underlying waiver credential. */
export function sealCounterWaiverToken(token: string, expiresAt: Date): string | null {
  const key = secretKeyFromEnvironment();
  if (key.status !== "ok") return null;
  return (
    PREFIX +
    sealSecret(
      JSON.stringify({ purpose: PURPOSE, token, expiresAt: expiresAt.toISOString() }),
      key.key,
    )
  );
}

export function isCounterWaiverToken(token: string): boolean {
  return token.startsWith(PREFIX);
}

/** Refuse malformed, wrongly scoped and expired envelopes, including after signing. */
export function openCounterWaiverToken(token: string, now = nowDate()): string | null {
  if (!isCounterWaiverToken(token)) return null;
  const key = secretKeyFromEnvironment();
  if (key.status !== "ok") return null;
  const plaintext = openSecret(token.slice(PREFIX.length), key.key);
  if (!plaintext) return null;
  try {
    const value: unknown = JSON.parse(plaintext);
    if (!value || typeof value !== "object") return null;
    const payload = value as Record<string, unknown>;
    if (
      payload.purpose !== PURPOSE ||
      typeof payload.token !== "string" ||
      typeof payload.expiresAt !== "string"
    )
      return null;
    const expiry = Date.parse(payload.expiresAt);
    return Number.isFinite(expiry) && expiry > now.getTime() ? payload.token : null;
  } catch {
    return null;
  }
}
