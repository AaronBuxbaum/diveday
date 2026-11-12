import { cacheLife } from "next/cache";
import { Suspense } from "react";
import { StoredPhoto } from "@/components/StoredPhoto";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { getDb } from "@/db/client";
import { isMarineLifeSlug } from "@/db/marine-life-catalog";
import type { MonthSightings } from "@/features/month-sightings";
import { monthSightings } from "@/features/month-sightings";
import { cacheStamp, reportCacheRead, shopRowsCacheGeneration } from "@/features/runtime-cache";
import { marineLifeCard } from "@/i18n/marine-life-labels";
import type { DiverTranslator } from "@/i18n/messages";
import { nowDate } from "@/lib/clock";
import { monthNames } from "@/lib/format";
import { utcToWallTime } from "@/lib/zoned";

/**
 * The shelf as the shopfront places it: read behind its own `<Suspense>`, so a
 * shop with years of logs never holds up the schedule, and nothing at all
 * while the evidence is too thin, or while the shop has sightings switched off
 * on Features (nothing is read then). `mt-12` is the page's section gap.
 */
export function MonthSightingsSection({
  shop,
  ...props
}: {
  shop: { id: string; sightingsEnabled: boolean };
  tz: string;
  locale: string;
  t: DiverTranslator;
}) {
  if (!shop.sightingsEnabled) return null;
  return (
    <Suspense fallback={null}>
      <MonthSightingsLoaded shopId={shop.id} {...props} />
    </Suspense>
  );
}

/**
 * **The month's sightings, read at most once an hour per shop and month**
 * (performance audit 2026-11-11, item 4): three statements over every season
 * the shop has logged, for a shelf whose answer turns over once a month, used
 * to run on every anonymous view of the shopfront. Cached the way "Our year"
 * is (`publicShopYear` in `OurYear.tsx`): keyed on the shop, its zone and the
 * shop's own month, so the entry turns over at the shop's month boundary;
 * `hours` lets a crew's log from this morning count by the afternoon. The
 * cached scope opens the database itself, stamps when it computed, and every
 * read logs `cache.read` (docs/architecture/performance-budgets.md, "Runtime
 * caches"). Also keyed on `shopRowsCacheGeneration()`, 0 in a deployment, so
 * the e2e routes that rewrite a shop's rows expire the entry: a seeded
 * `monthSightings` fact must not meet the empty entry an earlier test cached.
 */
async function publicMonthSightings(
  shopId: string,
  timeZone: string,
  // Read by nothing in the body: they are here to be part of the cache key.
  _shopMonth: number,
  _rowsGeneration: number,
) {
  "use cache";
  cacheLife("hours");
  const sightings = await monthSightings(await getDb(), shopId, timeZone, nowDate());
  return { sightings, computedAtMs: cacheStamp() };
}

async function MonthSightingsLoaded({
  shopId,
  tz,
  locale,
  t,
}: {
  shopId: string;
  tz: string;
  locale: string;
  t: DiverTranslator;
}) {
  const shopMonth = utcToWallTime(nowDate(), tz).month;
  const cached = await publicMonthSightings(shopId, tz, shopMonth, shopRowsCacheGeneration());
  reportCacheRead("month_sightings", cached.computedAtMs, { shopId });
  const sightings = cached.sightings;
  if (!sightings) return null;
  return <MonthSightingsShelf sightings={sightings} locale={locale} t={t} className="mt-12" />;
}

/**
 * **"What you might see in March"** on the shopfront (batch 4, K4): the
 * species this shop's own crews logged most often in the current month, across
 * every season they have recorded.
 *
 * Rendered only when `monthSightings` found enough evidence; a shop without it
 * gets no section at all rather than an empty one. Every line is a frequency
 * over the shop's own logged departures ("seen on 9 of the 14 March trips our
 * crews logged"), and the
 * note under the list says it is a record and not a promise.
 */
export function MonthSightingsShelf({
  sightings,
  locale,
  t,
  className = "",
}: {
  sightings: MonthSightings;
  locale: string;
  t: DiverTranslator;
  className?: string;
}) {
  const month = monthNames(locale)[sightings.month - 1] ?? "";
  // A slug the catalog has retired has no words; it drops rather than
  // printing as punctuation (the rule `fieldGuideCards` follows).
  const rows = sightings.species.flatMap((tally) => {
    if (!isMarineLifeSlug(tally.speciesSlug)) return [];
    return [{ tally, card: marineLifeCard(tally.speciesSlug, t) }];
  });
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="month-sightings" className={className || undefined}>
      <h2 id="month-sightings" className={`font-brand-display ${SECTION_TITLE_CLASS}`}>
        {t("schedule.monthSeen.heading", { month })}
      </h2>
      <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {rows.map(({ tally, card }) => (
          <li key={card.slug} className="flex min-w-0 items-center gap-3">
            <StoredPhoto
              src={card.imageUrl}
              alt=""
              className="size-14 shrink-0 rounded-lg border border-border"
              sizes="56px"
            />
            <div className="min-w-0">
              <p className="font-medium">{card.name}</p>
              <p className="text-sm text-muted">
                {t("schedule.monthSeen.line", { seen: tally.trips, trips: sightings.trips, month })}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-muted">{t("schedule.monthSeen.honest", { month })}</p>
    </section>
  );
}
