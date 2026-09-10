import Link from "next/link";
import { groupLabelClass } from "@/components/ui/ledger";
import { BANNER_TITLE_CLASS } from "@/components/ui/typography";
import { getDb } from "@/db/client";
import { getShopYear } from "@/db/reporting";
import { listShopsShowingYearOnDiveday } from "@/db/shops";
import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { nowDate } from "@/lib/clock";
import { publicSchedulePath, publicShopYearCardPath } from "@/lib/public-routes";
import { summarizeShopYear } from "@/lib/shop-year";

/**
 * **The proof under the hero** (ADR 20260908-one-hand, decision 6, lever T,
 * and the marketing thread that runs through round 4): DiveDay's homepage
 * carries nothing that is not, or could not be, a screenshot. This is a real
 * shop's real year card, drawn by that shop's own departures, shown because
 * that shop turned a switch on.
 *
 * **No shop has said yes, so nothing renders.** That is the resting state and
 * it is not an empty state: a band explaining that no shop has opted in would
 * be worse than the page it interrupts. The same is true of a shop that said
 * yes and has not sailed this year — its card is a 404 and the band moves on
 * to the next candidate rather than embedding a broken picture.
 *
 * The sentence beside the card is one a number on the card can prove, which is
 * the rule the whole band exists to keep: "has run N boats on DiveDay this
 * year" is the card's own boats figure, said in words. No money is available
 * to say — `getShopYear` does not read any — and the one door is the shop's own
 * storefront.
 */
export async function ShopYearBand({ locale }: { locale: DiverLocale }) {
  const t = diverTranslator(locale);
  const db = await getDb();
  const candidates = await listShopsShowingYearOnDiveday(db);
  if (candidates.length === 0) return null;

  const now = nowDate();
  for (const shop of candidates) {
    const year = summarizeShopYear(
      await getShopYear(db, shop.id, { timeZone: shop.timezone, now }),
    );
    if (!year.hasActivity) continue;
    return (
      <section className="border-b border-border bg-surface">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-6 py-16 lg:grid-cols-[minmax(0,600px)_1fr] lg:items-center lg:py-20">
          {/* The card as the shop has it — the same route, the same pixels, at
              the size the design draws. `unoptimized` is not available to a
              plain <img>, and that is the point: this is an image route, not an
              asset, so it re-renders when the shop's year moves. */}
          {/** biome-ignore lint/performance/noImgElement: a live image route, not a static asset — next/image would cache a card that must follow the shop's own year. */}
          <img
            src={publicShopYearCardPath(shop.slug)}
            alt={t("shopYear.band.alt", {
              shop: shop.name,
              divers: year.divers,
              boats: year.boatsOut,
              sites: year.siteCount,
            })}
            width={600}
            height={400}
            className="w-full rounded-panel border border-border"
          />
          <div>
            <p className={groupLabelClass("primary")}>{t("shopYear.band.eyebrow")}</p>
            <h2 className={`mt-3 ${BANNER_TITLE_CLASS} sm:text-4xl`}>
              {t("shopYear.band.claim", { shop: shop.name, boats: year.boatsOut })}
            </h2>
            <p className="mt-4 max-w-xl text-lg leading-8 text-muted">
              {t("shopYear.band.source")}
            </p>
            <p className="mt-3 text-sm text-muted">{t("shopYear.band.note")}</p>
            <Link
              href={publicSchedulePath(shop.slug)}
              className="mt-6 inline-block font-medium text-primary hover:underline"
            >
              {t("shopYear.band.door")}
            </Link>
          </div>
        </div>
      </section>
    );
  }
  return null;
}
