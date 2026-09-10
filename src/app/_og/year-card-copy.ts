import type { DiverTranslator } from "@/i18n/messages";
import { formatMonthDay, monthNames } from "@/lib/format";
import type { ShopYearCard } from "@/lib/shop-year";
import type { YearCardCopy } from "./year-card";

/**
 * Every word on the year card, in one place (ADR 20260908-one-hand, decision
 * 6, lever T).
 *
 * Two routes render the card — the staff act on the year page and the public
 * one DiveDay's homepage embeds — and the homepage's whole claim is that what
 * it shows is the card the shop has, so the sentence and the three facts are
 * resolved here rather than twice.
 *
 * **The diver bundle, not the staff one.** The card leaves the shop: it is read
 * by a landlord, a marina and a visitor to DiveDay's homepage, none of whom
 * work there. Its words belong with the other copy DiveDay writes for people
 * who are not staff.
 *
 * It takes a `ShopYearCard` rather than the whole summary, so the close-outs —
 * and the staff name on each — are not reachable from here either (security
 * review, finding 2).
 *
 * Each fact has a fallback that always exists, because a real shop's year does
 * not always have all three: a shop that names no hull on its departures still
 * went to sea, and a shop that plans no site still took divers out. A card with
 * a blank third of it is worse than a card that says a plainer true thing.
 */
export function yearCardCopy({
  shopName,
  year,
  t,
  locale,
}: {
  shopName: string;
  year: ShopYearCard;
  t: DiverTranslator;
  locale: string;
}): YearCardCopy {
  const stillRunning = year.lastDay < `${year.year}-12-31`;
  const range = year.sinceMonth
    ? t("shopYear.card.rangeSince", {
        year: String(year.year),
        month: monthNames(locale)[year.sinceMonth - 1] ?? "",
      })
    : stillRunning
      ? t("shopYear.card.rangeToDate", {
          year: String(year.year),
          // The day without its year: the line already opens with it.
          date: formatMonthDay(
            Number(year.lastDay.slice(5, 7)),
            Number(year.lastDay.slice(8, 10)),
            locale,
          ),
        })
      : t("shopYear.card.range", { year: String(year.year) });

  const topBoat = year.boats[0];
  const topSite = year.sites[0];
  return {
    shopName,
    range,
    sentence: t("shopYear.card.sentence", {
      divers: year.divers,
      boats: year.boatsOut,
      sites: year.siteCount,
    }),
    facts: [
      {
        key: "busiest",
        value: year.busiestDay
          ? formatMonthDay(
              Number(year.busiestDay.day.slice(5, 7)),
              Number(year.busiestDay.day.slice(8, 10)),
              locale,
            )
          : String(year.daysAtSea),
        label: year.busiestDay
          ? t("shopYear.card.busiestDay", { divers: year.busiestDay.divers })
          : t("shopYear.card.daysAtSea"),
      },
      {
        key: "boat",
        value: String(topBoat ? topBoat.days : year.daysAtSea),
        label: topBoat
          ? t("shopYear.card.boatDays", { name: topBoat.name })
          : t("shopYear.card.daysAtSea"),
      },
      {
        key: "site",
        value: topSite ? topSite.name : String(year.divers),
        label: topSite
          ? t("shopYear.card.mostDived", { times: topSite.times })
          : t("shopYear.card.divers"),
      },
    ],
  };
}
