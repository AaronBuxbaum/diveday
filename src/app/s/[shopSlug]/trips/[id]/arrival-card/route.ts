import { type NextRequest, NextResponse } from "next/server";
import { verifyBookingCapability } from "@/db/booking-capabilities";
import { getDb } from "@/db/client";
import { getReadyPageData } from "@/db/ready";
import { getShopBySlug } from "@/db/shops";
import { getTripWithBooked } from "@/db/trips";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { publicTripPath } from "@/lib/public-routes";
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
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ shopSlug: string; id: string }> },
) {
  const { shopSlug, id } = await params;
  if (!uuidParam(id)) return new NextResponse("Not found", { status: 404 });
  const db = await getDb();
  const bookingToken = request.nextUrl.searchParams.get("booking")?.trim();
  if (!bookingToken) return new NextResponse("Not found", { status: 404 });
  const capability = await verifyBookingCapability(db, {
    token: bookingToken,
    purpose: "readiness",
  });
  if (!capability) return new NextResponse("Not found", { status: 404 });
  const ready = await getReadyPageData(db, capability.bookingId);
  if (
    !ready ||
    ready.shop.slug !== shopSlug ||
    ready.detail.trip.id !== id ||
    ready.detail.cancelled
  ) {
    return new NextResponse("Not found", { status: 404 });
  }

  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) return new NextResponse("Not found", { status: 404 });
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
  const tripUrl = new URL(publicTripPath(shopSlug, id), request.url).toString();
  const support = [shop.contactPhone, shop.contactEmail].filter(Boolean).join(" · ");
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
