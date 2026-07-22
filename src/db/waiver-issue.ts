import { and, eq, ne } from "drizzle-orm";
import { publicAppUrl } from "@/lib/notifications";
import type { AppDb } from "./client";
import { sendAndRecordNotification } from "./notifications";
import { getBookingReadiness } from "./readiness";
import { bookings, people, shops, trips } from "./schema";
import { issueWaiverRequest } from "./waivers";

/**
 * The one place that issues a waiver link *and* delivers it. Both the trip
 * roster and the Today/Blockers one-tap sends call this so a waiver is never
 * issued by a different rule in two places (the transaction lives in
 * `issueWaiverRequest`; this wraps it with delivery and the context a notice
 * needs). It is self-contained — given a shop and a booking it fetches the
 * diver, trip, and shop names itself — so a caller never threads snapshots
 * through hidden form fields.
 */

/**
 * How the diver actually got (or did not get) their link. Anything that is not
 * `sent` means staff must hand over the fallback link themselves, so the UI
 * shows it rather than silently claiming an email is on its way.
 */
export type WaiverDelivery = "sent" | "no_email" | "unconfigured";

export type IssueAndDeliverWaiverResult =
  | {
      ok: true;
      bookingId: string;
      diverName: string;
      /** The bearer link (token path) to hand over when delivery was not `sent`. */
      token: string;
      delivery: WaiverDelivery;
    }
  | {
      ok: false;
      bookingId: string;
      /** Best-effort name for the notice; null only when the booking is gone. */
      diverName: string | null;
      reason: "already_completed" | "error";
    };

/**
 * Issue a fresh waiver link for a booking and email it when we can. Emailing is
 * best-effort: a missing address, missing app origin, or a failed/disabled
 * provider all resolve to a non-`sent` delivery so the caller surfaces the
 * private link instead of pretending mail went out.
 */
export async function issueAndDeliverWaiver(
  db: AppDb,
  shopId: string,
  bookingId: string,
): Promise<IssueAndDeliverWaiverResult> {
  const [ctx] = await db
    .select({ person: people, trip: trips, shop: shops })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .where(
      and(
        eq(bookings.id, bookingId),
        eq(bookings.shopId, shopId),
        ne(bookings.status, "cancelled"),
      ),
    )
    .limit(1);

  const outcome = await issueWaiverRequest(db, { shopId, bookingId });
  if (!outcome.ok) {
    return {
      ok: false,
      bookingId,
      diverName: ctx?.person.fullName ?? null,
      reason: outcome.reason === "already_completed" ? "already_completed" : "error",
    };
  }

  // `issueWaiverRequest` already validated the booking, so `ctx` is present in
  // every real path; guard only so a race that cancels mid-issue degrades to the
  // link rather than throwing.
  const diverName = ctx?.person.fullName ?? "";
  const email = ctx?.person.email ?? null;
  const origin = publicAppUrl();

  let delivery: WaiverDelivery = "unconfigured";
  if (!email) {
    delivery = "no_email";
  } else if (origin && ctx) {
    const result = await sendAndRecordNotification(db, {
      kind: "waiver_request",
      waiverRecordId: outcome.recordId,
      bookingId,
      shopId,
      to: email,
      diverName: ctx.person.fullName,
      shopName: ctx.shop.name,
      tripTitle: ctx.trip.title,
      completionUrl: new URL(`/waivers/${outcome.token}`, `${origin}/`).toString(),
      expiresAt: outcome.expiresAt,
      timezone: ctx.shop.timezone,
    });
    delivery = result.status === "sent" ? "sent" : "unconfigured";
  }

  return { ok: true, bookingId, diverName, token: outcome.token, delivery };
}

/**
 * Send a waiver the moment a diver joins a dive — but only when one is actually
 * needed. "Needed" is exactly the readiness engine's `waiver_not_sent` blocker:
 * the trip requires a waiver, the diver has no current signature carried forward
 * (sign-once), and none has been issued yet. Reusing that decision keeps the
 * join-send from ever emailing a redundant link to a diver who already signed,
 * or issuing on a trip that gates no waiver. Returns null when nothing was sent.
 *
 * Idempotent by construction: a second call finds a `waiver_pending` blocker
 * (not `waiver_not_sent`) and skips, so a retried join never stacks links.
 */
export async function issueWaiverOnJoin(
  db: AppDb,
  shopId: string,
  bookingId: string,
): Promise<IssueAndDeliverWaiverResult | null> {
  const readiness = await getBookingReadiness(db, shopId, bookingId);
  const needsWaiver = readiness?.blockers.some((blocker) => blocker.code === "waiver_not_sent");
  if (!needsWaiver) return null;
  return issueAndDeliverWaiver(db, shopId, bookingId);
}
