import { ExpiredLinkCard } from "@/components/ExpiredLinkCard";
import {
  resolveRevokedBookingCapability,
  staleBookingCapabilityForToken,
} from "@/db/booking-capabilities";
import type { getDb } from "@/db/client";
import { getBookingPayment } from "@/db/payments";
import { getReadyPageData } from "@/db/ready";
import { getShopById } from "@/db/shops";
import { type DiverTranslator, diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { cancelledNotice } from "./CancelledNotice";
import { ExpiredLink } from "./ExpiredLink";
import { TripCancelledCard } from "./TripCancelledCard";

/**
 * **What a readiness link that no longer verifies says.** The page calls this
 * from inside its `!capability` block and nowhere else: every branch here
 * starts from a token `verifyBookingCapability` refused, so each one resolves
 * the token a relaxed way, for one honest terminal card, and authorizes
 * nothing.
 */
export async function readyDeadLink({
  db,
  token,
  cancelled,
  sent,
  anonT,
}: {
  db: Awaited<ReturnType<typeof getDb>>;
  token: string;
  /** `?cancelled=` — the diver's own cancel redirected here; only the trigger to look. */
  cancelled: string | undefined;
  /** `?sent=` — a fresh link was just asked for (`ExpiredLink`). */
  sent: string | undefined;
  /** The visitor's own locale: a dead link resolves no shop to negotiate with. */
  anonT: DiverTranslator;
}) {
  // Revoked, expired, or never ours — with one exception. The diver's own
  // cancel revokes this exact token as part of cancelling and then redirects
  // back to it with `?cancelled=1`, so the verified path above can never show
  // that diver their own confirmation. Resolve the token with the revocation
  // check relaxed — never the cancelled-booking or shop-scoping checks — so
  // that one redirect lands on an honest confirmation rather than the generic
  // "isn't available" notice (ADR 20260821-the-diver-may-release-their-own-seat).
  // `cancelled` is only the trigger to look: the refund copy itself comes
  // from the booking's own current payment row, fetched fresh here, never
  // from the query string.
  if (cancelled) {
    const resolved = await resolveRevokedBookingCapability(db, { token, purpose: "readiness" });
    if (resolved) {
      const data = await getReadyPageData(db, resolved.bookingId);
      if (data?.detail.cancelled) {
        const payment = await getBookingPayment(db, data.shop.id, resolved.bookingId);
        return cancelledNotice(
          payment?.status,
          data.detail.trip.title,
          data.detail.shop.name,
          anonT,
        );
      }
    }
  }
  /**
   * **The departure was called off, which is why this token stopped
   * verifying at all.**
   *
   * `verifyBookingCapability` fails closed on `trips.status = 'cancelled'`
   * (`src/db/booking-capabilities.ts`) — rightly, since an outstanding
   * capability must not keep paying, rental-fit or cancel authority for a
   * trip that no longer runs. But this page reaches for the same call as its
   * *identity* lookup, so a blow-out took the diver's link out from under
   * them: the branch written below for exactly this case sat behind a guard
   * (`trip_status` has two values, so `departureCancelled` **is** the
   * condition that already returned null) that could never be reached, and
   * every diver a cancellation stranded was told the one thing that is
   * false — that their link had run out — with no door back and a "send me
   * a fresh one" button that fails the same check.
   *
   * Resolved the relaxed way the diver's-own-cancel path above resolves, and
   * used only to *say* what happened: the hash must still match an unexpired
   * capability genuinely issued for this purpose, and what it renders is a
   * terminal card with no form on it, so it authorizes nothing. A genuinely
   * aged-out link resolves nothing here and keeps the honest expired notice
   * below.
   */
  const stranded = await resolveRevokedBookingCapability(db, { token, purpose: "readiness" });
  if (stranded) {
    const data = await getReadyPageData(db, stranded.bookingId);
    // A cancelled *booking* keeps its own path above; this is the diver whose
    // seat is still live under a departure that is not (`callTripBlowout`
    // cancels the trip and leaves every booking active, because whether each
    // seat is refunded stays a per-booking staff decision).
    if (data?.departureCancelled && !data.detail.cancelled) {
      const strandedT = diverTranslator(await requestLocale(data.shop.defaultLocale));
      return <TripCancelledCard db={db} data={data} t={strandedT} />;
    }
  }
  // **Name the shop where the token still tells us which one it is.**
  //
  // `/ready` is the link in the 24-hour trip reminder, so every ordinary way
  // of reaching a dead one — a bookmark from last season, a forwarded email,
  // a reminder for a trip that moved — landed here, on four words telling a
  // diver holding a phone to ask a shop this page would not name (issue
  // #801). The waiver page solved this first and its comments say why the
  // expired branch used to "bail out before the shop (and so its contact
  // info) was ever loaded".
  //
  // `staleBookingCapabilityForToken` relaxes expiry and revocation and
  // nothing else: the hash must still match a capability genuinely issued
  // for this purpose. It is used for the shop's *name and published contact
  // details* and for nothing else — no booking, no diver, no trip is read
  // through an expired token, because an expired token is not a key.
  const stale = await staleBookingCapabilityForToken(db, { token, purpose: "readiness" });
  const staleShop = stale ? await getShopById(db, stale.shopId) : null;
  if (staleShop) {
    const staleT = diverTranslator(await requestLocale(staleShop.defaultLocale));
    return <ExpiredLink token={token} shop={staleShop} t={staleT} sent={sent} />;
  }
  // Nothing resolved at all (garbage, or a token that was never ours). There
  // is no shop to attribute it to without weakening the guarantee the model
  // rests on — a bearer token reveals only its own record.
  return (
    <ExpiredLinkCard
      title={anonT("ready.unavailableHeading")}
      text={anonT("ready.unavailableBody")}
    />
  );
}
