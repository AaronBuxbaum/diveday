import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";
import { YEAR_CARD_SIZE, YearCard } from "@/app/_og/year-card";
import { yearCardCopy } from "@/app/_og/year-card-copy";
import { canPersonViewShopReports, getShopYear } from "@/db/reporting";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { nowDate } from "@/lib/clock";
import { allowSvgRasterization } from "@/lib/og-rasterizer";
import { requireShopSurface } from "@/lib/session";
import { summarizeShopYear } from "@/lib/shop-year";
import { utcToWallTime } from "@/lib/zoned";

/**
 * **Print the card** (ADR 20260908-one-hand, decision 6, lever T) — the shop's
 * year as one 3:2 image, from the year page's own act.
 *
 * Staff-only, behind the same gate the year page itself is behind: the card
 * carries no money and no diver's name, but who may read a shop's year is
 * still the owner's and the manager's question, and a card is a URL that gets
 * pasted.
 *
 * A shop with no departures this year has no card: the page hides the act, and
 * a hand-typed URL gets a 404 rather than an image of four zeroes.
 */
export async function GET(request: Request, { params }: { params: Promise<{ shopSlug: string }> }) {
  const { shopSlug } = await params;
  const { db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonViewShopReports,
    refusal: { notice: "reports-not-authorized" },
  });
  const now = nowDate();
  // `?year=` prints a past year the page's year switch opened (fifth loop,
  // item 25); four digits and no later than this year, or this year.
  const asked = new URL(request.url).searchParams.get("year");
  const thisYear = utcToWallTime(now, shop.timezone).year;
  const requested = asked && /^\d{4}$/.test(asked) ? Number(asked) : thisYear;
  const year = summarizeShopYear(
    await getShopYear(db, shop.id, {
      timeZone: shop.timezone,
      now,
      year: requested <= thisYear ? requested : thisYear,
    }),
  );
  if (!year.hasActivity) {
    return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const locale = await requestLocale(shop.defaultLocale);
  // Before any ImageResponse is built: Next's image optimizer disables
  // libvips' SVG loader process-wide, which is what satori rasterizes through.
  // See src/lib/og-rasterizer.ts — the failure mode is a severed socket.
  await allowSvgRasterization();
  return new ImageResponse(
    <YearCard
      year={year}
      brandColor={shop.brandColor}
      copy={yearCardCopy({
        shopName: shop.name,
        year,
        t: diverTranslator(locale),
        locale,
      })}
    />,
    YEAR_CARD_SIZE,
  );
}
