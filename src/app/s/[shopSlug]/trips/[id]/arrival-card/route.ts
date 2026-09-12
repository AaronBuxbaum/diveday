import { type NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { issueBookingCapability, verifyBookingCapability } from "@/db/booking-capabilities";
import { getDb } from "@/db/client";
import { getShopBySlug } from "@/db/shops";
import { getTripWithBooked } from "@/db/trips";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { arrivalCardExpiryFor } from "@/lib/booking-capabilities";
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
 * **The code the counter recognises, drawn at 512 device pixels.**
 *
 * `SheetCode.tsx`'s number and its reasoning verbatim: about 400 dpi at the
 * size a card prints, past what a phone camera needs and past what a laser
 * blurs. Encoded on the server into the document because this file is saved
 * and opened offline — a code that arrived one paint later would be a white
 * square on a no-signal morning, which is the whole occasion for the card.
 */
const CODE_PIXELS = 512;

/** How wide the code is drawn in the saved page. Print size, not payload size. */
const CODE_DRAWN_PX = 180;

/**
 * The section the code sits in. The caller skips it entirely when no
 * capability was minted: a card that cannot carry its code is still the card —
 * the address, the landmark and the phone number are what a diver opens it
 * for — so a refused mint degrades to the rest of the page, never to a 404.
 */
function arrivalCode(dataUrl: string, heading: string, body: string, alt: string): string {
  return (
    '<section><p class="label">' +
    escapeHtml(heading) +
    // Not escaped, deliberately: this is our own base64 `data:` URL, and
    // escaping its `+` and `/` would break the image. Nothing diver-supplied
    // reaches it — `QRCode.toDataURL` is the only writer.
    '</p><p><img src="' +
    dataUrl +
    '" alt="' +
    escapeHtml(alt) +
    '" width="' +
    String(CODE_DRAWN_PX) +
    '" height="' +
    String(CODE_DRAWN_PX) +
    '"></p><p>' +
    escapeHtml(body) +
    "</p></section>"
  );
}

/**
 * A deliberately boring HTML download: it is a saved post-booking place card,
 * authorized by the Ready capability and never a copy of the private Ready page.
 *
 * **It carries a bearer credential, so what that credential buys is the whole
 * design** (issue #1600). The QR holds an `arrival`-purpose booking capability
 * — not the readiness token in the URL that authorized this download. The card
 * is a file: the diver saves it, prints it, and can forward it. A readiness
 * token on that paper would be their medical, waiver and payment surface
 * travelling in a hotel lobby; an arrival token buys exactly what saying a
 * surname at the counter already buys, so a card left on a seat leaks nothing
 * the manifest does not already show a staffer.
 *
 * The raw `bookings.id` the paper pass carries is deliberately *not* reused
 * here. That id is safe on the pass because only a staff session resolves it,
 * inside its own shop; this page is reached by a diver's own bearer token, and
 * a database id printed on a diver-facing surface is an identifier we can
 * never revoke.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ shopSlug: string; id: string }> },
) {
  const { shopSlug, id } = await params;
  if (!uuidParam(id)) return new NextResponse("Not found", { status: 404 });
  const bookingToken = request.nextUrl.searchParams.get("booking")?.trim();
  if (!bookingToken) return new NextResponse("Not found", { status: 404 });

  // Before the hash comparison, like every other capability door: this one
  // both verifies a bearer token and writes a row, so an unthrottled version
  // would let one caller walk tokens and grow the table at the same time. The
  // caller who already holds a readiness link is the one that matters here —
  // those links are re-tapped all week and forwarded in inboxes — because a
  // loop over this GET rasterizes a code and inserts a capability row per
  // request, `src/lib/retention.ts` prunes none of them, and past
  // `MAX_LIVE_CAPABILITIES_PER_PURPOSE` it starts revoking the card the diver
  // printed for tomorrow morning. Refused as the same 404 as every other
  // refusal, so a throttle can answer no question the token could not.
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

  // Minted per download rather than reused: tokens are stored only as hashes,
  // so an existing row's plaintext can never be re-derived. The pile stays
  // bounded by `MAX_LIVE_CAPABILITIES_PER_PURPOSE` retiring the oldest, and
  // cancelling the booking revokes every purpose including this one.
  //
  // The expiry is stated rather than defaulted, because this credential leaves
  // on paper: the trip-anchored default is trip end + 30 days, so a seat booked
  // a season out printed a card that scanned for the season plus a month
  // (`security-reviewer`, issue #1600). `arrivalCardExpiryFor` bounds it to the
  // departure the card is for — see it for why that number is the kiosk's.
  const issued = await issueBookingCapability(db, {
    shopId: shop.id,
    bookingId: capability.bookingId,
    purpose: "arrival",
    expiresAt: arrivalCardExpiryFor(trip.startsAt),
  });

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
  const filename = `${shopSlug.replace(/[^a-z0-9_-]/gi, "-")}-arrival-card.html`;
  const codeSection = issued
    ? arrivalCode(
        await QRCode.toDataURL(issued.token, { margin: 1, width: CODE_PIXELS }),
        t("trip.arrivalCodeHeading"),
        t("trip.arrivalCodeBody"),
        t("trip.arrivalCodeAlt"),
      )
    : "";
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
    codeSection,
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
