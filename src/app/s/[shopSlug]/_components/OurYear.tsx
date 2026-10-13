import { cacheLife } from "next/cache";
import { yearCardCopy } from "@/app/_og/year-card-copy";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { getDb } from "@/db/client";
import { getShopYear } from "@/db/reporting";
import type { DiverTranslator } from "@/i18n/messages";
import { type CalendarDate, calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { cacheStamp, reportCacheRead } from "@/lib/observability/runtime-cache";
import { summarizeShopYear } from "@/lib/shop-year";

/**
 * **The year's counts, read at most once an hour per shop and day** (code
 * review 2026-10-13, item 12): a five-statement aggregate over the whole
 * year, for a sentence that changes once a day, used to run on every
 * anonymous view of the shopfront. The first cache under `/s`.
 *
 * Keyed on the shop, its zone and the shop's own day, so the entry turns over
 * at the shop's midnight rather than the server's; `hours` refreshes it within
 * the day, so a boat that came home this morning is counted by the afternoon.
 * The executor is not an argument (a cache key must serialize): the cached
 * scope opens the database itself.
 *
 * **Plain `"use cache"`, measured rather than switched** (code review
 * 2026-10-13b, item 19). It runs on Next's in-memory handler, which on
 * serverless may not outlive one request. `"use cache: remote"` would not fix
 * that by itself: with no `cacheHandlers` in `next.config.ts`, Next backs
 * `remote` with the same in-memory LRU, and a platform handler, where one
 * exists, adds a network lookup and a bill to every read. So the entry carries
 * the moment it was computed and every read logs `cache.read` with `hit` or
 * `miss`; docs/architecture/performance-budgets.md ("Runtime caches") says how
 * to read a week of it and when to switch.
 */
async function publicShopYear(
  shopId: string,
  timeZone: string,
  // Read by nothing in the body: it is here to be part of the cache key.
  _shopDay: CalendarDate,
) {
  "use cache";
  cacheLife("hours");
  const year = await getShopYear(await getDb(), shopId, { timeZone, now: nowDate() });
  return { year, computedAtMs: cacheStamp() };
}

/**
 * **"Our year" at the foot of the shopfront** — the Reports year card's
 * sentence ("312 divers. 140 boats out. 18 reefs and wrecks.") where a diver
 * comparing shops reads it. Only with the shop's yes (`shops.public_year_enabled`,
 * off by default), and only counts: `getShopYear` carries no money across its
 * boundary at all, and this panel shows nothing but the range and the
 * sentence. Nothing at all before a departure has sailed: a year of zeroes is
 * not something a shop would choose to publish.
 */
export async function OurYearSection({
  shop,
  locale,
  t,
  className = "",
}: {
  shop: { id: string; name: string; timezone: string };
  locale: string;
  t: DiverTranslator;
  className?: string;
}) {
  const shopDay = calendarDateInTimezone(nowDate(), shop.timezone);
  const cached = await publicShopYear(shop.id, shop.timezone, shopDay);
  reportCacheRead("our_year", cached.computedAtMs, { shopId: shop.id });
  const year = summarizeShopYear(cached.year);
  if (!year.hasActivity) return null;
  const copy = yearCardCopy({ shopName: shop.name, year, t, locale });
  return (
    <OurYearPanel
      className={className}
      heading={t("shopYear.panel.heading")}
      range={copy.range}
      sentence={
        // A shop that plans no site still went to sea; "0 reefs and wrecks"
        // would publish a gap in its records as a fact about its year.
        year.siteCount > 0
          ? copy.sentence
          : t("shopYear.panel.sentenceNoSites", { divers: year.divers, boats: year.boatsOut })
      }
    />
  );
}

/** The panel itself: a heading, the range it covers, and the one sentence. */
export function OurYearPanel({
  heading,
  range,
  sentence,
  className = "",
}: {
  heading: string;
  range: string;
  sentence: string;
  className?: string;
}) {
  return (
    <section aria-labelledby="our-year" className={className}>
      <h2 id="our-year" className={SECTION_TITLE_CLASS}>
        {heading}
      </h2>
      <p className="mt-1 text-sm text-muted">{range}</p>
      <p className="mt-3 text-lg font-medium text-foreground">{sentence}</p>
    </section>
  );
}
