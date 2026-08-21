import { type NextRequest, NextResponse } from "next/server";
import { issueBookingCapability, verifyBookingCapability } from "@/db/booking-capabilities";
import { getDb } from "@/db/client";
import { readinessLinkPath } from "@/lib/booking-capabilities";
import { publicTripPath } from "@/lib/public-routes";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";

/**
 * The embed confirmation's door out to `/ready`, resolved when the diver
 * actually taps it rather than when the page renders.
 *
 * **Why a route and not a link.** `/ready/[token]` needs a `readiness`
 * capability, and a capability's token is stored hashed — there is no reading
 * an existing one back to build a URL from. So the confirmation used to mint a
 * fresh one on *every render*, which costs two things: each render writes a row
 * for one booking on an anonymous, unauthenticated path, and
 * `issueBookingCapability` retires the oldest live capability past
 * `MAX_LIVE_CAPABILITIES_PER_PURPOSE`, so the twentieth reload of the embed
 * would revoke the readiness link `bookSpot` had already emailed to the diver.
 * A reload is not a request for a new credential; a tap is (`coderabbitai`).
 *
 * Minting still happens per tap rather than once per booking, for the same
 * reason `issueBookingCapability` never supersedes: a diver may be holding an
 * emailed link and this one at once, and both should work. The cap bounds the
 * set either way, and taps are bounded by a human where renders are not.
 *
 * **On the trade.** `confirm` stays read-only where ADR
 * 20260820-one-page-after-booking says it is — nothing here reads or writes the
 * booking. This exchanges a proof of "you booked this seat" for the readiness
 * capability that same booking's confirmation email already carried, so it
 * hands the bearer nothing they were not already sent. It is a GET, so the
 * caller links to it with a plain anchor: `next/link` prefetching would put us
 * straight back to minting on render.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ shopSlug: string; id: string }> },
) {
  const { shopSlug, id } = await params;
  // Every refusal below lands on the departure's own public page — never a 404
  // and never a distinct message, so this cannot answer "is that a real
  // booking?" for anyone walking tokens (`verifyBookingCapability` is the one
  // place that decides, and it fails closed on unknown, expired, revoked,
  // wrong-purpose and since-cancelled alike).
  const away = () => redirectTo(new URL(publicTripPath(shopSlug, id), request.url));
  const token = request.nextUrl.searchParams.get("booking");
  if (!token) return away();

  // Before the hash comparison, like every other capability door: this one
  // both verifies a bearer token and writes a row, so an unthrottled version
  // would let one caller walk tokens and grow the table at the same time. The
  // shared `capabilityAction` bucket — a diver taps their own link a handful of
  // times, never sixty.
  const ip = await clientIp();
  if (
    !(await checkRateLimit(rateLimitKey("confirm-token", ip), RATE_LIMITS.capabilityAction)).allowed
  ) {
    return away();
  }

  const db = await getDb();
  const capability = await verifyBookingCapability(db, { token, purpose: "confirm" });
  // Scoped to the departure in the path, exactly as the page scopes it through
  // `getBookingForTrip`: a live token is a token for *one* booking, and it must
  // not resolve through some other trip's URL.
  if (!capability || capability.tripId !== id) return away();

  const readiness = await issueBookingCapability(db, {
    shopId: capability.shopId,
    bookingId: capability.bookingId,
    purpose: "readiness",
  });
  if (!readiness) return away();

  return redirectTo(new URL(readinessLinkPath(readiness.token), request.url));
}

/**
 * `no-store` on every branch, not just the successful one. The success
 * `Location` carries a freshly minted bearer capability, so a shared cache
 * holding this response would hand one diver's readiness link to the next
 * caller of the same URL — and the refusals must not be cached either, or a
 * throttled or expired attempt would pin the answer for everyone behind it.
 */
function redirectTo(url: URL): NextResponse {
  return NextResponse.redirect(url, { headers: { "Cache-Control": "private, no-store" } });
}
