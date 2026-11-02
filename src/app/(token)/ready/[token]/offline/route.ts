import { verifyBookingCapability } from "@/db/booking-capabilities";
import { getDb } from "@/db/client";
import { readPlannedFlySafe } from "@/db/fly-safe-plan";
import { getReadyPageData } from "@/db/ready";
import { getShopBySlug } from "@/db/shops";
import { listTripChangeEvents } from "@/db/trip-change-events";
import { listTripDives } from "@/db/trips";
import { requestLocale } from "@/i18n/request";
import { nowMs } from "@/lib/clock";
import { packingConfidence } from "@/lib/diver-planning";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { buildDiverChecklist } from "@/lib/readiness-summary";
import { clientIp } from "@/lib/request-ip";
import { theBoatIsHome } from "@/lib/thread-steps";
import { buildReadySnapshot } from "./ready-snapshot";

/**
 * **The copy of `/ready/<token>` a phone keeps for no signal** (issue #3225):
 * a JSON snapshot of one verified booking, fetched by the `/ready/` service
 * worker (`src/worker/ready-page-cache.ts`) each time the page is kept.
 *
 * Authorized exactly as the page is: the token in the path is the readiness
 * capability, and the answer is that booking's alone. Only the fields named in
 * `ReadySnapshotFacts` are read out of it, and none of them is a credential,
 * so the stored bytes carry no token, link or form.
 *
 * **Throttled like every other capability door**, before the token is looked
 * up, and answered **429**, never 404: the worker reads a 404 as "keep nothing"
 * and clears the copy, and a diver on a busy hotel network must not lose a good
 * copy because someone else's requests share their address.
 *
 * **404 means "keep nothing"**: a dead link, a cancelled seat, a departure
 * called off, a seat the shop released, a held identity or a boat already home
 * all answer the same, and the worker then clears the copy it holds.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (
    !(
      await checkRateLimit(
        rateLimitKey("ready-offline", await clientIp()),
        RATE_LIMITS.capabilityAction,
      )
    ).allowed
  ) {
    return new Response("Too many requests", {
      status: 429,
      headers: { "Cache-Control": "no-store", "Retry-After": "60" },
    });
  }
  const db = await getDb();
  const capability = await verifyBookingCapability(db, { token, purpose: "readiness" });
  const data = capability ? await getReadyPageData(db, capability.bookingId) : null;
  if (
    !data ||
    data.detail.cancelled ||
    data.departureCancelled ||
    data.seatReleased ||
    data.identityHeld ||
    theBoatIsHome(data.detail.trip)
  ) {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const { shop, detail } = data;
  const [fullShop, tripDives, changes, flySafe] = await Promise.all([
    getShopBySlug(db, shop.slug),
    listTripDives(db, shop.id, data.trip.id),
    listTripChangeEvents(db, shop.id, data.trip.id, data.bookingCreatedAt),
    readPlannedFlySafe(db, data),
  ]);
  // What the page's own checklist still has open, by the page's own builder.
  const openItems = buildDiverChecklist(detail.requirement, detail.readiness, {
    participantType: data.participantType,
    statedFree: detail.statedFree,
    trainingNoCardAsked: detail.trainingNoCardAsked,
  })
    .filter((item) => item.state !== "done")
    .map((item) => item.detailCode);
  const packing = packingConfidence(
    fullShop?.packingList ?? [],
    data.rentalFit,
    (fullShop?.briefingMinutes ?? 15) > 0,
    data.trip.course?.gearIncluded === true,
  );
  const snapshot = buildReadySnapshot({
    locale: await requestLocale(shop.defaultLocale),
    generatedAt: nowMs(),
    shop: {
      name: detail.shop.name,
      timezone: detail.shop.timezone,
      contactPhone: shop.contactPhone,
      contactEmail: shop.contactEmail,
      address: shop.address,
      dockCallMinutes: shop.dockCallMinutes,
    },
    trip: {
      title: detail.trip.title,
      startsAt: detail.trip.startsAt,
      endsAt: detail.trip.endsAt,
      meetingPointLabel: data.trip.meetingPointLabel,
      meetingPointAddress: data.trip.meetingPointAddress,
      arrivalLandmark: data.trip.arrivalLandmark,
      arrivalParkingNote: data.trip.arrivalParkingNote,
      arrivalTransitNote: data.trip.arrivalTransitNote,
      arrivalLookFor: data.trip.arrivalLookFor,
      arrivalFirstInteraction: data.trip.arrivalFirstInteraction,
    },
    pickup: { time: data.pickupTime, location: data.hotelPickupLocation },
    openItems,
    sites: tripDives.flatMap(({ diveSite }) => (diveSite?.name ? [diveSite.name] : [])),
    packing: { personal: packing.bringPersonal, bring: packing.bring },
    changes,
    flySafe,
  });
  return Response.json(snapshot, {
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
