import { ImageResponse } from "next/og";
import { CARD_STYLE, OG_COLORS, OG_WORDMARK, ogCredit, ogFooter } from "@/app/_og/card";
import { getDb } from "@/db/client";
import { getShopBySlug } from "@/db/shops";
import { getTripWithBooked } from "@/db/trips";
import { perDiverBookingPriceCents } from "@/lib/courses";
import { formatMoneyCents, formatShortDate } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import { allowSvgRasterization } from "@/lib/og-rasterizer";
import { spotsRemaining } from "@/lib/trips";
import { uuidParam } from "@/lib/uuid";

// i18n-exempt-file: link-preview card rendered for crawlers with no visitor
// locale context, the same carve-out as the root `opengraph-image.tsx`.
/**
 * The unfurl card for one departure's public trip page. A diver sharing a
 * trip link deserves better than the generic DiveDay card the root
 * `opengraph-image.tsx` renders everywhere — this one names the trip, date,
 * and price. Kept to the same non-personal facts an anonymous visitor of the
 * trip page already sees (title, date, price, open-seat count); never a
 * diver name or roster (mirrors the privacy contract in
 * `src/lib/structured-data.ts` and `src/app/recap/[token]/opengraph-image.tsx`).
 * A held or full trip never claims availability it doesn't have — the seats
 * line only renders when seats are actually open, same honesty the
 * `Event`/`Offer` availability field already commits to.
 */
export const alt = "A dive trip on DiveDay.";

export const size = { width: 1200, height: 630 };

export const contentType = "image/png";

function genericCard() {
  return new ImageResponse(
    <div style={CARD_STYLE}>
      {OG_WORDMARK}
      <div style={{ display: "flex", fontSize: 56, fontWeight: 600, letterSpacing: "-0.03em" }}>
        A dive trip
      </div>
      {ogFooter()}
    </div>,
    size,
  );
}

export default async function TripOpenGraphImage({
  params,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
}) {
  const { shopSlug, id: tripId } = await params;
  // Link-preview crawlers request this route independently of the page. A
  // malformed id must produce the generic card rather than reaching Postgres,
  // where comparing a non-UUID literal against trips.id is a 500.
  if (!uuidParam(tripId)) return genericCard();
  // Before any ImageResponse is built: Next's image optimizer disables
  // libvips' SVG loader process-wide, which is what @vercel/og rasterizes
  // through. See src/lib/og-rasterizer.ts — the failure mode is a severed
  // socket, not an error page.
  await allowSvgRasterization();
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) return genericCard();

  const trip = await getTripWithBooked(db, shop.id, tripId);
  if (!trip) return genericCard();

  const locale = shop.defaultLocale;
  const when = formatShortDate(trip.startsAt, locale, shop.timezone);
  const currency = toShopCurrency(shop.currency);
  const perDiverPriceCents = perDiverBookingPriceCents(trip, trip.course);
  const priceLine =
    perDiverPriceCents !== null ? formatMoneyCents(perDiverPriceCents, currency, locale) : null;
  // Honest availability only — a held or sold-out trip shows nothing here
  // rather than a stale seat count (mirrors `tripJsonLd`'s SoldOut handling).
  const remaining = trip.conditionsHold ? 0 : spotsRemaining(trip);

  // **The shop's card, not ours** (issue #810). The wordmark used to be the
  // largest, topmost element and the footer spliced the shop's own scarcity
  // line onto DiveDay's tagline with a middot — "3 spots left · A calmer way
  // to run a dive day" reads as one claim about the same thing. The shop leads
  // now, the seats line stands alone, and the tagline is gone: it is DiveDay's
  // sentence, and this card is posted by a dive shop to its own audience.
  return new ImageResponse(
    <div style={CARD_STYLE}>
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        {shop.logoUrl ? (
          // biome-ignore lint/performance/noImgElement: ImageResponse needs a direct remote image
          <img src={shop.logoUrl} alt="" width="64" height="64" style={{ objectFit: "cover" }} />
        ) : null}
        <div style={{ display: "flex", fontSize: 34, fontWeight: 600 }}>{shop.name}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div
          style={{
            display: "flex",
            fontSize: 64,
            fontWeight: 600,
            lineHeight: 1.1,
            letterSpacing: "-0.03em",
            maxWidth: 1000,
          }}
        >
          {trip.title}
        </div>
        <div style={{ display: "flex", fontSize: 32, color: OG_COLORS.muted, gap: 16 }}>
          <div style={{ display: "flex" }}>{when}</div>
          {priceLine ? <div style={{ display: "flex" }}>· {priceLine}</div> : null}
        </div>
      </div>
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24 }}
      >
        {remaining > 0 ? (
          ogFooter(`${remaining} ${remaining === 1 ? "spot" : "spots"} left`)
        ) : (
          <div style={{ display: "flex" }} />
        )}
        {ogCredit()}
      </div>
    </div>,
    size,
  );
}
