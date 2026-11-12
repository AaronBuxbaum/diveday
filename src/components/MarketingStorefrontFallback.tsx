import { MarketingStorefrontPhoto } from "@/components/MarketingStorefrontPhoto";
import { StarRating } from "@/components/StarRating";
import { groupLabelClass } from "@/components/ui/group-label";
import { DoorChevron } from "@/components/ui/ledger";
import { FIGURE_CLASS, ITEM_TITLE_CLASS, LEAD_TITLE_CLASS } from "@/components/ui/typography";
import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { AppBar, MOCK_BODY, MOCK_PRIMARY_BUTTON } from "./MarketingScreenFallbacks";

/** The public week ledger's day rule figure, numeral and words, drawn at mock scale. */
const DAY_RULE_WORD = "text-sm font-bold tracking-[0.18em] uppercase";

/**
 * **The shop's own booking page** — `src/app/s/[shopSlug]/page.tsx`: the hero
 * (`_components/ShopfrontHero.tsx`: cover, name, tagline, the
 * star rating and its count), the year the shop opened from the badge wall
 * (`BadgeWall.tsx`), the next boat with space (`NextBoatCard.tsx`), and one
 * day of the week's departures (`WeekLedger.tsx`): the day rule, then each
 * boat's time, title, sites, seats and price, with the badge spent only on the
 * nearly full one. The bundled reef cover is the demo shop’s own. Left out:
 * the other badges, the week picker and the rest of the week.
 */
export function StorefrontFallback({ locale }: { locale: DiverLocale }) {
  const t = diverTranslator(locale);
  const rating = t("fallback.storefront.rating");
  return (
    <div className="bg-background">
      <AppBar label={t("fallback.storefront.label")} />
      <div className={`@container ${MOCK_BODY}`}>
        <MarketingStorefrontPhoto />
        <div className="grid gap-4 @md:grid-cols-[minmax(0,1fr)_minmax(0,13rem)] @md:items-start">
          <div>
            {/* i18n-exempt: sample shop name used only in marketing mockups */}
            <h3 className={`font-brand-display ${LEAD_TITLE_CLASS}`}>Blue Mantis Divers</h3>
            <p className="mt-1 text-sm text-muted">{t("fallback.storefront.tagline")}</p>
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <StarRating
                rating={5}
                label={t("fallback.storefront.ratingLabel", { rating })}
                tone="accent"
              />
              <span className="font-semibold tabular-nums">{rating}</span>
              <span aria-hidden="true" className="text-muted">
                ·
              </span>
              <span className="text-muted">{t("fallback.storefront.reviews", { count: 126 })}</span>
            </p>
            <p className="mt-3">
              <span className="inline-flex min-h-7 items-center rounded-full border border-border bg-surface px-2.5 text-xs">
                {t("fallback.storefront.since")}
              </span>
            </p>
          </div>
          <div className="rounded-inset border border-border bg-surface p-4">
            <p className={groupLabelClass("primary")}>{t("fallback.storefront.nextBoat")}</p>
            <p className="mt-1">
              <span className={FIGURE_CLASS}>{t("fallback.storefront.nextTime")}</span>
              <span className="ms-2 text-sm font-medium text-muted">
                {t("fallback.storefront.nextWhen")}
              </span>
            </p>
            <p className="mt-1 text-sm font-semibold">{t("fallback.tripName")}</p>
            <p className="mt-0.5 text-xs text-muted">
              {t("fallback.spotsLeft", { count: 3 })} · {t("fallback.storefront.perDiver")}
            </p>
            <button type="button" disabled className={`mt-3 w-full ${MOCK_PRIMARY_BUTTON}`}>
              {t("fallback.storefront.bookThisBoat")}
            </button>
          </div>
        </div>
        <h3 className={`mt-5 font-brand-display ${ITEM_TITLE_CLASS}`}>
          {t("fallback.storefront.scheduleHeading")}
        </h3>
        <div className="mt-2 flex items-center gap-3">
          <span className={`min-w-[2ch] leading-none ${FIGURE_CLASS}`}>10</span>
          <span className={DAY_RULE_WORD}>{t("fallback.storefront.weekday")}</span>
          <span className={`${DAY_RULE_WORD} font-medium text-muted`}>
            {t("fallback.storefront.month")}
          </span>
          <span aria-hidden="true" className="h-px flex-1 bg-border" />
        </div>
        <ul className="mt-1">
          <li className="flex flex-col gap-1 border-b border-border py-2.5 @md:flex-row @md:items-center @md:gap-4">
            <p className="text-sm font-semibold whitespace-nowrap tabular-nums @md:w-36 @md:shrink-0">
              {t("fallback.storefront.reefTime")}
            </p>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t("fallback.tripName")}</p>
              <p className="mt-0.5 text-xs text-muted">{t("fallback.storefront.reefSites")}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <p className="text-sm text-muted tabular-nums">
                {t("fallback.spotsLeft", { count: 3 })}
              </p>
              <p className="text-sm font-semibold tabular-nums">
                {t("fallback.storefront.reefPrice")}
              </p>
              <DoorChevron className="ms-auto" />
            </div>
          </li>
          <li className="flex flex-col gap-1 border-b border-border py-2.5 @md:flex-row @md:items-center @md:gap-4">
            <p className="text-sm font-semibold whitespace-nowrap tabular-nums @md:w-36 @md:shrink-0">
              {t("fallback.storefront.nightTime")}
            </p>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t("fallback.nightDive")}</p>
              {/* i18n-exempt: sample dive site used only in marketing mockups */}
              <p className="mt-0.5 text-xs text-muted">City of Washington</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <p className="text-sm text-muted tabular-nums">
                {t("fallback.spotsLeft", { count: 2 })}
              </p>
              <p className="text-sm font-semibold tabular-nums">
                {t("fallback.storefront.nightPrice")}
              </p>
              <DoorChevron className="ms-auto" />
            </div>
          </li>
        </ul>
      </div>
    </div>
  );
}
