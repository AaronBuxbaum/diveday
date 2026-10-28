import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { authSecret } from "./auth-secret";

type Scope = { shopId: string; personId: string; dayStart: string; mode: "initialize" | "ack" };
const signatureShape = /^[A-Za-z0-9_-]{43}$/;
const uuidShape = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function signature(scope: Scope, body: string): string {
  if (!authSecret) throw new Error("AUTH_SECRET is required to sign Today snapshots");
  const key = hkdfSync("sha256", authSecret, "", "diveday-today-catch-up", 32);
  return createHmac("sha256", Buffer.from(key))
    .update(JSON.stringify([scope.shopId, scope.personId, scope.dayStart, scope.mode, body]))
    .digest("base64url");
}

export function signTodayCatchUp(scope: Scope, eventIds: string[]): string {
  const body = Buffer.from(JSON.stringify(eventIds)).toString("base64url");
  return `${body}.${signature(scope, body)}`;
}

export function verifyTodayCatchUp(token: string, scope: Scope): string[] | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, supplied] = parts;
  if (!body || !supplied || !signatureShape.test(supplied)) return null;
  const expected = signature(scope, body);
  if (!timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return null;
  try {
    const ids: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return Array.isArray(ids) && ids.every((id) => typeof id === "string" && uuidShape.test(id))
      ? ids
      : null;
  } catch {
    return null;
  }
}
