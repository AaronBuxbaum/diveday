import { and, eq, ne } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { publicAppUrl, recipientLocale } from "@/lib/notifications";
import type { AppDb } from "./client";
import { sendAndRecordNotification } from "./notifications";
import { getBookingReadiness } from "./readiness";
import { bookings, people, shops, trips } from "./schema";
import { hasLiveWaiverRequest, issueWaiverRequest, staleWaiverRecordForToken } from "./waivers";

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
export type WaiverDelivery =
  | "sent"
  | "no_email"
  /** No `APP_HOST`, so there is no origin to build the link on — nothing was attempted. */
  | "no_app_origin"
  | "unconfigured"
  | "test_recipient"
  | "failed";

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

  // Two different "we could not mail this" states that used to collapse into
  // one. `unconfigured` means no email provider; `no_app_origin` means the
  // provider may be fine but `APP_HOST` is unset, so there is no origin to
  // build the diver's link on and nothing is attempted. Telling a shop "no
  // email provider configured" when the actual gap is a missing APP_HOST sends
  // them to look at the wrong setting.
  let delivery: WaiverDelivery = "no_app_origin";
  if (!email) {
    delivery = "no_email";
  } else if (origin && ctx) {
    const result = await sendAndRecordNotification(db, {
      kind: "waiver_request",
      waiverRecordId: outcome.recordId,
      bookingId,
      shopId,
      to: email,
      locale: recipientLocale(ctx.person.locale, ctx.shop.defaultLocale),
      diverName: ctx.person.fullName,
      shopName: ctx.shop.name,
      tripTitle: ctx.trip.title,
      completionUrl: new URL(`/waivers/${outcome.token}`, `${origin}/`).toString(),
      expiresAt: outcome.expiresAt,
      timezone: ctx.shop.timezone,
    });
    delivery =
      result.status === "sent"
        ? "sent"
        : result.status === "not_configured"
          ? "unconfigured"
          : result.errorCode === "invalid_test_recipient"
            ? "test_recipient"
            : "failed";
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

/**
 * What a diver's own rescue attempt from a dead waiver link amounted to. A code,
 * never a sentence — the page picks the words (docs ADR
 * 20260731-domain-layer-copy-leaks).
 */
export type WaiverLinkRescue =
  | "sent"
  | "no_email"
  | "already_signed"
  | "current_link_live"
  | "unavailable"
  | "failed";

/**
 * A diver's self-serve rescue for a waiver link that aged out: issue a fresh
 * one and mail it to the address already on their booking.
 *
 * The security shape matters more than the mechanics. A waiver URL *is* its
 * capability, so a stale one that leaked (a forwarded email, a shared screen)
 * must never be tradeable for fresh access. Two rules keep that true:
 * the fresh token goes only to the address on file — never to the caller, and
 * never displayed or confirmed back on the page — and the return value is a
 * bare outcome code carrying no address, no token, and no booking detail. What
 * a bearer of a dead link can do here is *trigger a delivery to its owner*,
 * which is exactly the affordance staff already had and no more.
 *
 * Repeat taps are safe by construction, and by one explicit refusal. Issuing
 * supersedes *every* non-superseded pending record for the booking, so a rescue
 * fired while a fresher link is still live would kill that live link and take
 * the diver's saved draft with it — a stale URL in the wrong hands would be a
 * remote "wipe this diver's half-filled waiver" button. `hasLiveWaiverRequest`
 * is the guard: when the booking already has a signable link, this reports
 * `current_link_live` and issues nothing. Otherwise `staleWaiverRecordForToken`
 * keeps resolving the original token after a send, so a second tap on a link
 * whose replacement has since aged out replaces it again rather than failing.
 * A cancelled booking or a sailed trip is refused by the same issuing
 * transaction the staff path uses, and a booking already covered by a signature
 * reports `already_signed` rather than mailing a pointless link.
 */
export async function emailFreshWaiverLink(
  db: AppDb,
  token: string,
  now: Date = nowDate(),
): Promise<WaiverLinkRescue> {
  const stale = await staleWaiverRecordForToken(db, token, now);
  if (!stale?.bookingId) return "unavailable";
  if (await hasLiveWaiverRequest(db, stale.bookingId, now)) return "current_link_live";
  const outcome = await issueAndDeliverWaiver(db, stale.shopId, stale.bookingId);
  if (!outcome.ok) return outcome.reason === "already_completed" ? "already_signed" : "unavailable";
  if (outcome.delivery === "sent") return "sent";
  if (outcome.delivery === "no_email") return "no_email";
  // Issued, but nothing left the building — an unconfigured provider, a
  // rejected recipient, a provider error. Never claim mail is on its way.
  return "failed";
}
