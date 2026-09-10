import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";
import { YEAR_CARD_SIZE, YearCard } from "@/app/_og/year-card";
import { yearCardCopy } from "@/app/_og/year-card-copy";
import { getDb } from "@/db/client";
import { getShopYear } from "@/db/reporting";
import { getShopBySlug } from "@/db/shops";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { nowDate } from "@/lib/clock";
import { allowSvgRasterization } from "@/lib/og-rasterizer";
import { summarizeShopYear } from "@/lib/shop-year";

/**
 * **The shop's year card, in public** (ADR 20260908-one-hand, decision 6,
 * lever T) — the image DiveDay's homepage band embeds, and the only route in
 * this namespace whose existence a shop switches on and off.
 *
 * **The switch is the whole gate.** With `shops.show_year_on_diveday` off this
 * is a 404 for everyone, including someone who saw the URL while it was on;
 * with it on the image is public, because a picture on DiveDay's homepage is
 * public by definition. There is no token, no signature and no referrer check,
 * and pretending otherwise would be theatre: the card is drawn *because* the
 * shop asked for it to be shown to strangers.
 *
 * **What leaves the shop is exactly the card** — divers, boats out, sites, the
 * busiest day, the days each hull was at sea, and the strip. Never money (it is
 * not in `getShopYear` at all), never a diver's name, never a booking, never a
 * departure's own time. A shop with no departures this year is a 404 rather
 * than an image of zeroes.
 *
 * `no-store` at the reader and five minutes at a shared cache: turning the
 * switch off has to take the picture down, and a card cached for a day at the
 * edge would outlive the yes that made it.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ shopSlug: string }> },
) {
  const { shopSlug } = await params;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop?.showYearOnDiveday) {
    return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const now = nowDate();
  const year = summarizeShopYear(await getShopYear(db, shop.id, { timeZone: shop.timezone, now }));
  if (!year.hasActivity) {
    return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const locale = await requestLocale(shop.defaultLocale);
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
    {
      ...YEAR_CARD_SIZE,
      headers: { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=60" },
    },
  );
}
