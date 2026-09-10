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
import { shopYearCard, summarizeShopYear } from "@/lib/shop-year";

/**
 * **The shop's year card, in public** (ADR 20260908-one-hand, decision 6,
 * lever T) — the image DiveDay's homepage band embeds, and the only route in
 * this namespace whose existence a shop switches on and off.
 *
 * **The switch is the gate for a real shop, and a demo tenant has no way in.**
 * With `shops.show_year_on_diveday` off this is a 404 for everyone, including
 * someone who saw the URL while it was on; with it on the image is public,
 * because a picture on DiveDay's homepage is public by definition. There is no
 * token, no signature and no referrer check, and pretending otherwise would be
 * theatre: the card is drawn *because* the shop asked for it to be shown to
 * strangers.
 *
 * `is_demo` is refused for the reason `listShopsShowingYearOnDiveday`
 * (src/db/shops.ts) gives: "Try the live demo" hands a visitor owner rights on
 * a throwaway tenant, so a demo shop's name, boats and sites are
 * attacker-supplied text — and this is a **dive.day URL serving an image of
 * that text**, whether or not the homepage links it (security review, finding
 * 1). Both doors carry the same two conditions.
 *
 * **What leaves the shop is exactly the card** — divers, boats out, sites, the
 * busiest day, the days each hull was at sea, and the strip. Never money (it is
 * not in `getShopYear` at all), never a diver's name, never a booking, never a
 * departure's own time, and never the staff name on a close-out: the card
 * renders from `shopYearCard()`, whose type has no `entries` at all. A shop
 * with no departures this year is a 404 rather than an image of zeroes.
 *
 * `no-store` at the reader and one minute at a shared cache. The switch is a
 * shop's consent and it has to be revocable in something like real time, so the
 * shared window is short rather than purged on the write: a purge would tie the
 * settings action to every cache in front of every deployment, and be wrong the
 * first time one of them missed it.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ shopSlug: string }> },
) {
  const { shopSlug } = await params;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop?.showYearOnDiveday || shop.isDemo) {
    return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const now = nowDate();
  const summary = summarizeShopYear(
    await getShopYear(db, shop.id, { timeZone: shop.timezone, now }),
  );
  // The close-outs, and the staff name on each, are dropped here rather than
  // ignored downstream (security review, finding 2).
  const year = shopYearCard(summary);
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
      headers: { "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=30" },
    },
  );
}
