import Link from "next/link";
import { StarRating } from "@/components/StarRating";
import { StoredPhoto } from "@/components/StoredPhoto";
import { buttonClass } from "@/components/ui/button";
import { PAGE_TITLE_CLASS } from "@/components/ui/typography";
import type { shopBySlugCached } from "@/features/shops-cached";
import type { DiverTranslator } from "@/i18n/messages";
import { parseBrandBadges } from "@/lib/brand";
import { cachedFormatter } from "@/lib/intl-cache";
import type { ReviewAggregate } from "@/lib/reviews";
import { BadgeWall } from "./BadgeWall";

/** The lower story uses the same rule to avoid repeating the welcome's identity. */
export function hasShopWelcomeContent(
  shop: Pick<
    NonNullable<Awaited<ReturnType<typeof shopBySlugCached>>>,
    "tagline" | "description" | "brandHeroImageUrl"
  >,
) {
  return Boolean(shop.tagline?.trim() || shop.description?.trim() || shop.brandHeroImageUrl);
}

/**
 * **A short welcome above the timetable** (Aaron, 2026-11-11, #4336, option B). A returning diver
 * wants the schedule first and still gets it one short scroll down; a first-timer, a parent or a
 * traveler comparing shops learns who these people are before reading departures.
 *
 * Built only from fields the shop has filled in: a photo, one line about the shop (the tagline,
 * else the description clamped to two lines), the rating when it has one, the badges, and two
 * doors. The full story stays lower on the page (`ShopfrontStory`). Screen only: the printed sheet
 * keeps the operational facts.
 */
export function ShopWelcome({
  shop,
  aggregate,
  newToDivingHref,
  seeScheduleHref,
  locale,
  t,
  className,
}: {
  shop: NonNullable<Awaited<ReturnType<typeof shopBySlugCached>>>;
  aggregate: ReviewAggregate;
  /** The courses page, or null when the shop teaches nothing. */
  newToDivingHref: string | null;
  /** The schedule's anchor, or null when there is no board to jump to. */
  seeScheduleHref: string | null;
  locale: string;
  t: DiverTranslator;
  className: string;
}) {
  const line = shop.tagline?.trim() || shop.description?.trim() || null;
  // Nothing the shop wrote and no photo: no welcome, rather than a name over two buttons.
  if (!hasShopWelcomeContent(shop)) return null;
  const badges = parseBrandBadges(shop.brandBadges);
  const average = aggregate.count > 0 ? aggregate.average : null;
  return (
    <section aria-label={shop.name} className={`print:hidden ${className}`}>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] sm:items-center sm:gap-8">
        {shop.brandHeroImageUrl ? (
          <div className="overflow-hidden rounded-panel border border-border bg-surface-sunken">
            <StoredPhoto
              src={shop.brandHeroImageUrl}
              alt={shop.brandHeroImageAlt ?? ""}
              className="aspect-[16/9] w-full sm:aspect-[4/3]"
              sizes="(min-width: 1152px) 508px, (min-width: 640px) 43vw, calc(100vw - 34px)"
              priority
            />
          </div>
        ) : null}
        <div className="min-w-0">
          <p className={`font-brand-display ${PAGE_TITLE_CLASS} text-balance`}>{shop.name}</p>
          {line ? (
            <p className="mt-2 line-clamp-2 max-w-xl text-lg text-pretty text-foreground/90">
              {line}
            </p>
          ) : null}
          {average === null ? null : (
            <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
              <StarRating
                rating={Math.round(average)}
                label={t("reviews.ratingOption", { rating: Math.round(average) })}
                tone="accent"
                className="text-base"
              />
              <span className="text-base font-semibold text-foreground tabular-nums">
                {cachedFormatter("num", Intl.NumberFormat, locale, {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                }).format(average)}
              </span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">
                {t("reviews.ratingsCount", { count: aggregate.count })}
              </span>
            </p>
          )}
          <BadgeWall
            badges={badges}
            isDemo={shop.isDemo}
            establishedYear={shop.establishedYear}
            t={t}
            className="mt-3"
          />
          {newToDivingHref || seeScheduleHref ? (
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              {newToDivingHref ? (
                <Link href={newToDivingHref} className={buttonClass({ className: "sm:w-auto" })}>
                  {t("schedule.welcome.newToDiving")}
                </Link>
              ) : null}
              {seeScheduleHref ? (
                <Link
                  href={seeScheduleHref}
                  className={buttonClass({ variant: "outline", className: "sm:w-auto" })}
                >
                  {t("schedule.welcome.seeSchedule")}
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
