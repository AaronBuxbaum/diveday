import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";
import { YEAR_CARD_SIZE, YearCard } from "@/app/_og/year-card";
import { yearCardCopy } from "@/app/_og/year-card-copy";
import { canPersonViewShopReports, getShopYear } from "@/db/reporting";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { isoDate, monthLabel, parseMonthKey } from "@/lib/calendar";
import { nowDate } from "@/lib/clock";
import { allowSvgRasterization } from "@/lib/og-rasterizer";
import { currentShopSeason, shopSeasonOf } from "@/lib/season";
import { requireShopSurface } from "@/lib/session";
import { summarizeShopYear } from "@/lib/shop-year";

/**
 * **Print the card** (ADR 20260908-one-hand, decision 6, lever T) — the shop's
 * selected month or year as one 3:2 image.
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
  // item 25); four digits and no later than this year, or this year. The year
  // is the shop's season, as on the page (issue #2657).
  const search = new URL(request.url).searchParams;
  const asked = search.get("year");
  const monthParam = search.get("month");
  const month = monthParam === null ? null : parseMonthKey(monthParam);
  if (monthParam !== null && !month) {
    return new NextResponse(null, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const seasonStart = { month: shop.seasonStartMonth, day: shop.seasonStartDay };
  const thisYear = currentShopSeason(now, shop.timezone, seasonStart).year;
  const requested = asked && /^\d{4}$/.test(asked) ? Number(asked) : thisYear;
  const year = summarizeShopYear(
    await getShopYear(db, shop.id, {
      timeZone: shop.timezone,
      now,
      ...(month
        ? {
            startsOn: isoDate(month.year, month.month, 1),
            endsOn: isoDate(
              month.year,
              month.month,
              new Date(Date.UTC(month.year, month.month, 0)).getUTCDate(),
            ),
          }
        : shopSeasonOf(requested <= thisYear ? requested : thisYear, seasonStart)),
    }),
  );
  if (!year.hasActivity) {
    return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const locale = await requestLocale(shop.defaultLocale);
  const copy = yearCardCopy({ shopName: shop.name, year, t: diverTranslator(locale), locale });
  // Before any ImageResponse is built: Next's image optimizer disables
  // libvips' SVG loader process-wide, which is what satori rasterizes through.
  // See src/lib/og-rasterizer.ts — the failure mode is a severed socket.
  await allowSvgRasterization();
  return new ImageResponse(
    <YearCard
      year={year}
      brandColor={shop.brandColor}
      copy={month ? { ...copy, range: monthLabel(month, locale) } : copy}
    />,
    YEAR_CARD_SIZE,
  );
}
