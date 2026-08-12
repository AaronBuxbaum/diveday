import { ImageResponse } from "next/og";
import { getDb } from "@/db/client";
import { getShopBySlug } from "@/db/shops";
import { getTripWithBooked } from "@/db/trips";
import { perDiverBookingPriceCents } from "@/lib/courses";
import { formatMoneyCents, formatShortDate } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import { allowSvgRasterization } from "@/lib/og-rasterizer";
import { spotsRemaining } from "@/lib/trips";

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

const CARD_STYLE = {
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column" as const,
  justifyContent: "space-between",
  padding: 72,
  backgroundColor: "#071720",
  backgroundImage: "linear-gradient(160deg, #071720 55%, #0d222d 100%)",
  color: "#e9f3f4",
  fontSize: 32,
};

const WORDMARK = (
  <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
    {/*
     * The bubble-trail mark from `src/components/Logo.tsx` — three ascending
     * bubbles, the top one the rationed coral accent. Restated as positioned
     * circles because satori has no `<svg>`, with `LogoMark`'s 24x24 viewBox
     * geometry doubled to a 48px box — the same mark-to-wordmark proportion
     * the site header uses (`size-6` beside `text-base`). Keep the two in step. It used to be one plain
     * circle here, which read as a bullet rather than as the logo.
     */}
    <div style={{ display: "flex", position: "relative", width: 48, height: 48 }}>
      <div
        style={{
          position: "absolute",
          left: 3,
          top: 20,
          width: 17,
          height: 17,
          borderRadius: 9999,
          backgroundColor: "#22d3ee",
          display: "flex",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 20,
          top: 9,
          width: 11,
          height: 11,
          borderRadius: 9999,
          backgroundColor: "#22d3ee",
          opacity: 0.75,
          display: "flex",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 29,
          top: 4,
          width: 7,
          height: 7,
          borderRadius: 9999,
          backgroundColor: "#ff8a7e",
          display: "flex",
        }}
      />
    </div>
    <div style={{ display: "flex", fontSize: 40, fontWeight: 600 }}>
      DiveDay
      <span style={{ color: "#ff8a7e" }}>.</span>
    </div>
  </div>
);

function genericCard() {
  return new ImageResponse(
    <div style={CARD_STYLE}>
      {WORDMARK}
      <div style={{ display: "flex", fontSize: 56, fontWeight: 600, letterSpacing: "-0.03em" }}>
        A dive trip
      </div>
      <div style={{ display: "flex", fontSize: 28, color: "#22d3ee" }}>
        A calmer way to run a dive day
      </div>
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

  return new ImageResponse(
    <div style={CARD_STYLE}>
      {WORDMARK}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "flex", fontSize: 30, color: "#9fc0c7" }}>{shop.name}</div>
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
        <div style={{ display: "flex", fontSize: 32, color: "#9fc0c7", gap: 16 }}>
          <div style={{ display: "flex" }}>{when}</div>
          {priceLine ? <div style={{ display: "flex" }}>· {priceLine}</div> : null}
        </div>
      </div>
      <div style={{ display: "flex", fontSize: 28, color: "#22d3ee" }}>
        {remaining > 0
          ? `${remaining} ${remaining === 1 ? "spot" : "spots"} left · A calmer way to run a dive day`
          : "A calmer way to run a dive day"}
      </div>
    </div>,
    size,
  );
}
