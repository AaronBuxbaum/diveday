import { authSecret } from "./auth-secret";
import { deriveLabelKey, signPayload, tagMatches } from "./signed-token";

type Scope = { shopId: string; personId: string; dayStart: string; mode: "initialize" | "ack" };
const uuidShape = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function signature(scope: Scope, body: string): string {
  if (!authSecret) throw new Error("AUTH_SECRET is required to sign Today snapshots");
  const key = deriveLabelKey(authSecret, "diveday-today-catch-up");
  return signPayload(
    key,
    JSON.stringify([scope.shopId, scope.personId, scope.dayStart, scope.mode, body]),
  );
}

export function signTodayCatchUp(scope: Scope, eventIds: string[]): string {
  const body = Buffer.from(JSON.stringify(eventIds)).toString("base64url");
  return `${body}.${signature(scope, body)}`;
}

export function verifyTodayCatchUp(token: string, scope: Scope): string[] | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, supplied] = parts;
  if (!body || !supplied) return null;
  if (!tagMatches(supplied, signature(scope, body))) return null;
  try {
    const ids: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return Array.isArray(ids) && ids.every((id) => typeof id === "string" && uuidShape.test(id))
      ? ids
      : null;
  } catch {
    return null;
  }
}
