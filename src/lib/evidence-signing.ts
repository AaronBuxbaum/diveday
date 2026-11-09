import { createHmac, timingSafeEqual } from "node:crypto";

/** Field-set versions live with the records; this envelope identifies only the signing key. */
const KEY_ID = /^[A-Za-z0-9_-]{1,48}$/;
const HEX_DIGEST = /^[a-f0-9]{64}$/;
type Environment = Readonly<Record<string, string | undefined>>;
type KeyRing = { active: string; keys: Record<string, string> };

function keyRing(env: Environment): KeyRing | null {
  const raw = env.WAIVER_INTEGRITY_KEYS;
  if (raw === undefined || raw === "") return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    const { active, keys } = value as Partial<KeyRing>;
    if (
      typeof active !== "string" ||
      !KEY_ID.test(active) ||
      active === "legacy" ||
      !keys ||
      typeof keys !== "object" ||
      Array.isArray(keys) ||
      !Object.hasOwn(keys, active)
    )
      throw new Error();
    for (const [id, secret] of Object.entries(keys)) {
      if (
        !KEY_ID.test(id) ||
        typeof secret !== "string" ||
        secret.length < (id === "legacy" ? 1 : 32)
      )
        throw new Error();
    }
    return { active, keys };
  } catch {
    // Configuration can contain secrets: never include the input or parser exception.
    throw new Error("evidence_key_config_invalid");
  }
}

function originalSecret(env: Environment): string {
  return (
    env.WAIVER_INTEGRITY_SECRET || env.AUTH_SECRET || "diveday-development-waiver-integrity-secret"
  );
}

function digest(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function envelopePayload(id: string, value: string): string {
  return `evidence-seal:v1:${id}\0${value}`;
}

/** New seals use the active key; existing installations do not rotate merely by deploying code. */
export function signEvidence(value: string, env: Environment = process.env): string {
  const ring = keyRing(env);
  if (!ring) return digest(value, originalSecret(env));
  return `hmac-sha256:${ring.active}:${digest(envelopePayload(ring.active, value), ring.keys[ring.active])}`;
}

/** Select one named key, never re-seal a record or try every key until one matches. */
export function verifyEvidence(
  value: string,
  seal: string,
  env: Environment = process.env,
): boolean {
  try {
    const ring = keyRing(env);
    let expected: string;
    let actual: string;
    if (HEX_DIGEST.test(seal)) {
      const secret = ring
        ? Object.hasOwn(ring.keys, "legacy")
          ? ring.keys.legacy
          : undefined
        : originalSecret(env);
      if (!secret) return false;
      expected = digest(value, secret);
      actual = seal;
    } else {
      const parts = seal.split(":");
      if (
        parts.length !== 3 ||
        parts[0] !== "hmac-sha256" ||
        !KEY_ID.test(parts[1]) ||
        !HEX_DIGEST.test(parts[2])
      )
        return false;
      const id = parts[1];
      if (!ring || id === "legacy" || !Object.hasOwn(ring.keys, id)) return false;
      expected = digest(envelopePayload(id, value), ring.keys[id]);
      actual = parts[2];
    }
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"));
  } catch {
    return false;
  }
}
