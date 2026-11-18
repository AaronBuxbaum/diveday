import { deriveLabelKey, signPayload, tagMatches } from "@/lib/signed-token";

/**
 * Disposable-key integrity experiment only. These are caller assertions, not
 * server-read facts. No caller, authorization decision, receipt, or activation
 * may use this module; a signature cannot prove actor or meeting identity.
 */
type TestClaims = {
  shopId: string;
  actorId: string;
  tripId: string;
  bookingId: string;
  generationId: string;
  meetingId: string;
  snapshotId: string;
  issuedAt: number;
  expiresAt: number;
};
type Identity = Omit<TestClaims, "issuedAt" | "expiresAt">;
const fields = [
  "shopId",
  "actorId",
  "tripId",
  "bookingId",
  "generationId",
  "meetingId",
  "snapshotId",
] as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const kidShape = /^[a-z0-9-]{1,32}$/;
const maxLifetime = 900;
function validClaims(claims: TestClaims): boolean {
  return (
    fields.every((field) => typeof claims[field] === "string" && uuid.test(claims[field])) &&
    Number.isSafeInteger(claims.issuedAt) &&
    claims.issuedAt >= 0 &&
    Number.isSafeInteger(claims.expiresAt) &&
    claims.expiresAt > claims.issuedAt &&
    claims.expiresAt - claims.issuedAt <= maxLifetime
  );
}
function payload(c: TestClaims): string {
  return JSON.stringify([...fields.map((field) => c[field]), c.issuedAt, c.expiresAt]);
}
function tag(secret: Buffer, message: string): string {
  return signPayload(
    deriveLabelKey(secret.toString("hex"), "test-only-dock-capture-assertion-v1"),
    message,
  );
}
export function issueTestAssertion(claims: TestClaims, kid: string, disposableKey: Buffer): string {
  if (!validClaims(claims) || !kidShape.test(kid) || disposableKey.length !== 32)
    throw new Error("invalid test assertion");
  const encoded = Buffer.from(payload(claims)).toString("base64url");
  const message = `v1.${kid}.${encoded}`;
  return `${message}.${tag(disposableKey, message)}`;
}
export function verifyTestAssertion(
  token: string,
  keyring: ReadonlyMap<string, Buffer>,
  expected: Identity,
  now: number,
): { kind: "integrity_only"; claims: TestClaims } | null {
  if (typeof token !== "string" || token.length > 2048 || !Number.isSafeInteger(now)) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [version, kid, encoded, supplied] = parts;
  if (
    version !== "v1" ||
    !kid ||
    !kidShape.test(kid) ||
    !encoded ||
    !/^[A-Za-z0-9_-]+$/.test(encoded) ||
    !supplied
  )
    return null;
  const key = keyring.get(kid);
  if (key?.length !== 32) return null;
  if (!tagMatches(supplied, () => tag(key, `${version}.${kid}.${encoded}`))) return null;
  try {
    const data = Buffer.from(encoded, "base64url");
    if (data.toString("base64url") !== encoded) return null;
    const values: unknown = JSON.parse(data.toString("utf8"));
    if (!Array.isArray(values) || values.length !== 9) return null;
    const [
      shopId,
      actorId,
      tripId,
      bookingId,
      generationId,
      meetingId,
      snapshotId,
      issuedAt,
      expiresAt,
    ] = values;
    const c = {
      shopId,
      actorId,
      tripId,
      bookingId,
      generationId,
      meetingId,
      snapshotId,
      issuedAt,
      expiresAt,
    } as TestClaims;
    if (
      !validClaims(c) ||
      payload(c) !== data.toString("utf8") ||
      now < c.issuedAt ||
      now >= c.expiresAt
    )
      return null;
    if (!fields.every((field) => c[field] === expected[field])) return null;
    return { kind: "integrity_only", claims: c };
  } catch {
    return null;
  }
}
