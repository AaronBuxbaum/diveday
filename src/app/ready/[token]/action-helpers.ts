import { redirect } from "next/navigation";
import { verifyBookingCapability } from "@/db/booking-capabilities";
import { getDb } from "@/db/client";
import { recordDiverOwnLocale } from "@/db/people";
import { getReadyPageData, type ReadyPageData } from "@/db/ready";
import { requestFirstHandLocale } from "@/i18n/request";
import type { DiverLocale } from "@/i18n/settings";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";

/**
 * The transactional half of the diver's readiness page, shared. Every action is
 * authorized the same way: the signed readiness token proves the diver owns
 * this booking, and every write is then scoped to that booking's shop/person.
 * A bearer of this token can only ever touch its own booking — never another
 * diver's — and the readiness state itself stays server-authoritative.
 *
 * The actions are split by the step they answer — `paperwork-actions.ts`
 * (waiver, contact, course forms), `cert-actions.ts`, `gear-actions.ts` (fit,
 * tanks, "nothing changed"), `day-of-actions.ts` (the day's details, running
 * late) and `booking-actions.ts` (pay, cancel, a fresh link) — and every one
 * opens through {@link contextFor} here. Not a `"use server"` module: nothing
 * in it is callable from the client.
 */

export const base = (token: string) => `/ready/${token}`;

/** Where a resolved action redirects when it can't proceed — a query param the page can turn into a real notice, never silence. */
export function bounceTarget(token: string, reason: "rate_limited" | "invalid"): string {
  return reason === "rate_limited" ? `${base(token)}?error=rate` : base(token);
}

/**
 * Refuse a write onto the diver record while the seat is held (#2082). The page
 * draws none of these forms for a held seat; this is the server's half, for a
 * hand-made post. Staff confirm who it is, and the forms come back.
 */
export function refuseWhileHeld(token: string, data: ReadyPageData): void {
  if (data.identityHeld) redirect(base(token));
}

export type ReadyContext = {
  db: AwaitedDb;
  bookingId: string;
  data: ReadyPageData;
  /**
   * What *this* request's `Accept-Language` asked for, or null when it carried
   * nothing DiveDay speaks. Already recorded on the person by `contextFor`;
   * carried here so a send in the same request uses the fresh signal rather
   * than the row read a moment before the write.
   */
  ownLocale: DiverLocale | null;
};
export type ReadyContextResult =
  | ({ ok: true } & ReadyContext)
  | { ok: false; reason: "rate_limited" | "invalid" };

export type AwaitedDb = Awaited<ReturnType<typeof getDb>>;

/**
 * Resolve the token to its booking + shop context, or report why it can't be
 * used. Rate-limited by IP before verification, so this one chokepoint
 * throttles every action in this file against both token guessing and
 * replay spam of a known link (CR-013). Every call site distinguishes the
 * two failure reasons (task 49): a throttled attempt tells the diver to wait
 * a moment, rather than redirecting silently and looking like the button did
 * nothing at all — a stale/invalid token still just bounces to the plain
 * unavailable notice, since there's nothing actionable to say about it.
 */
export async function contextFor(token: string): Promise<ReadyContextResult> {
  const ip = await clientIp();
  if (
    !(await checkRateLimit(rateLimitKey("readiness-token", ip), RATE_LIMITS.capabilityAction))
      .allowed
  ) {
    return { ok: false, reason: "rate_limited" };
  }
  const db = await getDb();
  const capability = await verifyBookingCapability(db, { token, purpose: "readiness" });
  if (!capability) return { ok: false, reason: "invalid" };
  const data = await getReadyPageData(db, capability.bookingId);
  if (!data || data.detail.cancelled) return { ok: false, reason: "invalid" };
  // The readiness link is the diver's own capability, so every action reaching
  // this point is the diver acting on their own booking from their own device
  // — first-hand evidence of the language they read (docs ADR
  // 20260731-per-person-notification-locale). Captured at this one chokepoint
  // so no individual action below has to remember to, and so it can never be
  // reached from a staff surface, whose header belongs to staff.
  const ownLocale = await requestFirstHandLocale();
  // Not on a held seat: the request's language is the link holder's, who may
  // not be the diver record the seat was matched to (#2082).
  if (!data.identityHeld) {
    await recordDiverOwnLocale(db, {
      shopId: data.shop.id,
      personId: data.person.id,
      locale: ownLocale,
    });
  }
  return { ok: true, db, bookingId: capability.bookingId, data, ownLocale };
}
