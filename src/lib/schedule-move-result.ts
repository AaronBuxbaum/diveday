import { authSecret } from "@/lib/auth-secret";
import { nowMs } from "@/lib/clock";
import { deriveLabelKey, signPayload, tagMatches } from "@/lib/signed-token";

const PURPOSE = "schedule-move-result-v1";
const MAX_AGE_MS = 2 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 30 * 1000;
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{1,512}\.[A-Za-z0-9_-]{43}$/;

export type ScheduleMoveResult = {
  id: string;
  gearReleased: number;
};

type Payload = {
  purpose: typeof PURPOSE;
  shopId: string;
  id: string;
  gearReleased: number;
  issuedAt: number;
};

function signature(payload: string): string {
  if (!authSecret) throw new Error("AUTH_SECRET is required to sign schedule move results.");
  return signPayload(deriveLabelKey(authSecret, "diveday-schedule-move-result"), payload);
}

/** A short-lived, shop-bound proof that a move action released the signed gear count. */
export function signScheduleMoveResult(shopId: string, id: string, gearReleased: number): string {
  if (!Number.isSafeInteger(gearReleased) || gearReleased < 0) {
    throw new Error("Schedule move result gear count must be a non-negative safe integer.");
  }
  const payload: Payload = { purpose: PURPOSE, shopId, id, gearReleased, issuedAt: nowMs() };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${signature(body)}`;
}

/** Returns move-result facts only when the token is authentic, fresh, and for this shop. */
export function verifyScheduleMoveResult(
  token: string | undefined,
  shopId: string,
): ScheduleMoveResult | null {
  if (!token || !TOKEN_SHAPE.test(token)) return null;
  const dot = token.indexOf(".");
  const body = token.slice(0, dot);
  const supplied = token.slice(dot + 1);
  if (!tagMatches(supplied, signature(body))) return null;

  try {
    const decoded = Buffer.from(body, "base64url").toString("utf8");
    if (Buffer.from(decoded, "utf8").toString("base64url") !== body) return null;
    const value: unknown = JSON.parse(decoded);
    if (!value || typeof value !== "object") return null;
    const payload = value as Partial<Payload>;
    if (
      payload.purpose !== PURPOSE ||
      payload.shopId !== shopId ||
      typeof payload.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.id) ||
      !Number.isSafeInteger(payload.gearReleased) ||
      (payload.gearReleased as number) < 0 ||
      !Number.isSafeInteger(payload.issuedAt)
    ) {
      return null;
    }
    const age = nowMs() - (payload.issuedAt as number);
    if (age > MAX_AGE_MS || age < -MAX_FUTURE_SKEW_MS) return null;
    return { id: payload.id, gearReleased: payload.gearReleased as number };
  } catch {
    return null;
  }
}
