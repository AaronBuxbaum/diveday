import { type NextRequest, NextResponse } from "next/server";
import { arrivalDockCallLine } from "@/components/TripArrivalCard";
import { verifyBookingCapability } from "@/db/booking-capabilities";
import { getBookingPickupTime } from "@/db/bookings";
import { getDb } from "@/db/client";
import { getShopBySlug } from "@/db/shops";
import { getTripWithBooked } from "@/db/trips";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { publicAppUrl } from "@/lib/notifications/app-url";
import { publicTripPath } from "@/lib/public-routes";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { type ShopAddressParts, shopAddressLines } from "@/lib/shop-address";
import { uuidParam } from "@/lib/uuid";

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ??
      character,
  );
}

function field(label: string, value: string | null | undefined): string {
  const clean = value?.trim();
  return clean
    ? '<section><p class="label">' +
        escapeHtml(label) +
        "</p><p>" +
        escapeHtml(clean) +
        "</p></section>"
    : "";
}

/**
 * A deliberately boring HTML download: it is a saved post-booking place card,
 * authorized by the Ready capability and never a copy of the private Ready page.
 *
 * **It carries no credential.** The card is a file: the diver saves it, prints
 * it, and can forward it, so the readiness token in the URL that authorized
 * this download never appears in it — that token is their medical, waiver and
 * payment surface, and paper left in a hotel lobby cannot be revoked. Nor does
 * the raw `bookings.id`: a database id printed on a diver-facing surface is an
 * identifier we can never take back.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ shopSlug: string; id: string }> },
) {
  const { shopSlug, id } = await params;
  if (!uuidParam(id)) return new NextResponse("Not found", { status: 404 });
  const bookingToken = request.nextUrl.searchParams.get("booking")?.trim();
  if (!bookingToken) return new NextResponse("Not found", { status: 404 });

  // Before the hash comparison, like every other capability door: an
  // unthrottled version would let one caller walk tokens. Refused as the same
  // 404 as every other refusal, so a throttle can answer no question the token
  // could not.
  if (
    !(
      await checkRateLimit(
        rateLimitKey("arrival-card", await clientIp()),
        RATE_LIMITS.capabilityAction,
      )
    ).allowed
  ) {
    return new NextResponse("Not found", { status: 404 });
  }

  const db = await getDb();
  const capability = await verifyBookingCapability(db, {
    token: bookingToken,
    purpose: "readiness",
  });
  // Scoped to the departure in the path: a live token is a token for *one*
  // booking, and it must not resolve through some other trip's URL. The
  // cancelled booking and the called-off departure are `verifyBookingCapability`'s
  // own refusals, so the card reads three fields off the capability rather
  // than paying for the whole readiness page to learn them.
  if (!capability || capability.tripId !== id) {
    return new NextResponse("Not found", { status: 404 });
  }

  const shop = await getShopBySlug(db, shopSlug);
  if (!shop || shop.id !== capability.shopId) {
    return new NextResponse("Not found", { status: 404 });
  }
  const trip = await getTripWithBooked(db, shop.id, id);
  if (trip?.status !== "scheduled") return new NextResponse("Not found", { status: 404 });

  const locale = await requestLocale(shop.defaultLocale);
  const t = diverTranslator(locale);
  const address: ShopAddressParts = {
    street: shop.addressStreet,
    locality: shop.addressLocality,
    region: shop.addressRegion,
    postalCode: shop.addressPostalCode,
    country: shop.addressCountry,
  };
  const customLabel = trip.meetingPointLabel?.trim() || null;
  const customAddress = trip.meetingPointAddress?.trim() || null;
  const label = customLabel ?? shop.name;
  const addressText = customAddress ?? shopAddressLines(address).join(", ");
  // The one link inside a file the diver keeps, so it is built from the
  // canonical origin rather than this request's `Host`. A Host-derived link is
  // fine for a redirect back to a sibling page and wrong on paper: whatever
  // hostname the download happened to be made through — a preview deployment,
  // a proxy, a forged header — is printed into a card nobody can correct
  // afterwards. `publicAppUrl` exists for exactly this and refuses to come
  // from a header; the request's own origin stays as the fallback for a
  // deployment whose `APP_HOST` does not validate.
  const tripUrl = new URL(publicTripPath(shopSlug, id), publicAppUrl() ?? request.url).toString();
  const support = [shop.contactPhone, shop.contactEmail].filter(Boolean).join(" · ");
  // The "be at the dock by" line `/ready` gives, on the paper a diver has at
  // the dock (issue #2034) — omitted, as there, for a diver being collected
  // from their hotel, and when the shop asks for no lead time.
  const pickupTime = await getBookingPickupTime(db, shop.id, capability.bookingId);
  const dockCallLine = pickupTime
    ? null
    : arrivalDockCallLine(t, trip.startsAt, shop.dockCallMinutes, locale, shop.timezone);
  const filename = `${shopSlug.replace(/[^a-z0-9_-]/gi, "-")}-arrival-card.html`;
  const html = [
    "<!doctype html>",
    '<html lang="',
    escapeHtml(locale),
    '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>",
    escapeHtml(t("trip.arrivalHeading")),
    " · ",
    escapeHtml(trip.title),
    "</title>",
    "<style>body{font-family:system-ui,sans-serif;max-width:38rem;margin:0 auto;padding:2rem;line-height:1.5;color:currentColor}h1{line-height:1.15}p{margin:.45rem 0}.label{font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;opacity:.68}section{border-top:1px solid currentColor;margin-top:1.5rem;padding-top:1rem}a{color:inherit;font-weight:600}</style></head>",
    '<body><p class="label">',
    escapeHtml(shop.name),
    "</p><h1>",
    escapeHtml(trip.title),
    "</h1><p>",
    escapeHtml(formatShortDate(trip.startsAt, locale, shop.timezone)),
    " · ",
    escapeHtml(formatTimeRangeTz(trip.startsAt, trip.endsAt, locale, shop.timezone)),
    "</p>",
    dockCallLine ? `<p><strong>${escapeHtml(dockCallLine)}</strong></p>` : "",
    field(t("trip.arrivalAtShop"), label),
    field(t("trip.arrivalAddress"), addressText),
    field(t("trip.arrivalLandmark"), trip.arrivalLandmark),
    field(t("trip.arrivalLookFor"), trip.arrivalLookFor),
    field(t("trip.arrivalParking"), trip.arrivalParkingNote),
    field(t("trip.arrivalTransit"), trip.arrivalTransitNote),
    field(t("trip.arrivalFirstInteraction"), trip.arrivalFirstInteraction),
    field(t("trip.arrivalSupport"), support),
    '<p><a href="',
    escapeHtml(tripUrl),
    '">',
    escapeHtml(t("trip.openPublicTrip")),
    "</a></p></body></html>",
  ].join("");

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
