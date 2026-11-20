import Link from "next/link";
import { Suspense } from "react";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { groupLabelClass } from "@/components/ui/group-label";
import type { AppDb } from "@/db/client";
import { readShopPick } from "@/features/shop-pick";
import type { shopBySlugCached } from "@/features/shops-cached";
import type { DiverTranslator } from "@/i18n/messages";
import { nowDate } from "@/lib/clock";
import { formatShortDate, formatTime } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import { seatPriceLabel, shelfCourseCards } from "./schedule-rows";
import { scheduleDayWords, scheduleSeatState, scheduleTripHref } from "./schedule-view";

type Shop = NonNullable<Awaited<ReturnType<typeof shopBySlugCached>>>;

/** One dot-joined line of facts. */
const joinFacts = (...parts: (string | null)[]) => parts.filter(Boolean).join(" · ");

/**
 * **The shop's pick** (#4823): the one departure or course the shop chose to put first, a card
 * between the welcome and the schedule. It reads behind its own boundary, so a shop with no pick
 * costs the page nothing and one with a pick never holds the schedule up. Screen only.
 */
export function ShopPick(props: {
  db: AppDb;
  shop: Shop;
  shopSlug: string;
  partySize: number;
  locale: string;
  t: DiverTranslator;
  className: string;
}) {
  if (!props.shop.pickTripId && !props.shop.pickCourseId) return null;
  return (
    <Suspense fallback={null}>
      <ShopPickCard {...props} />
    </Suspense>
  );
}

async function ShopPickCard({
  db,
  shop,
  shopSlug,
  partySize,
  locale,
  t,
  className,
}: Parameters<typeof ShopPick>[0]) {
  const now = nowDate();
  const pick = await readShopPick(db, shop, now);
  const tz = shop.timezone;
  const currency = toShopCurrency(shop.currency);
  let card: { title: string; summary: string | null; facts: string; href: string; cta: string };
  if (pick?.kind === "trip") {
    const { trip } = pick;
    const seats = scheduleSeatState(t, trip);
    // A boat with no seat left is no pick: its door would lead nowhere.
    if (seats.tone === "full") return null;
    const price = seatPriceLabel(trip, currency, locale);
    card = {
      title: trip.title,
      summary: trip.description,
      facts: joinFacts(
        `${scheduleDayWords(now, locale, tz).whenWord(trip.startsAt)} ${formatTime(trip.startsAt, locale, tz)}`,
        seats.text,
        price ? `${price} ${t("common.perDiver")}` : null,
      ),
      href: `${scheduleTripHref(shopSlug, trip.id, partySize)}#book`,
      cta: t("schedule.shopfront.bookThisBoat"),
    };
  } else if (pick?.kind === "course") {
    const [course] = shelfCourseCards({
      activeCourses: [pick.course],
      shelfNextStarts: new Map([[pick.course.id, pick.starts]]),
      shop,
      shopSlug,
      currency,
      locale,
      t,
    });
    // Courses switched off on the Features page: no card.
    if (!course) return null;
    const next = course.sessions[0];
    card = {
      title: course.title,
      summary: course.summary,
      facts: joinFacts(
        next ? formatShortDate(next.startsAt, locale, tz) : null,
        course.duration,
        course.price,
      ),
      href: course.href,
      cta: t("schedule.pick.seeCourse"),
    };
  } else {
    return null;
  }
  const eyebrow = t("schedule.pick.eyebrow");
  return (
    <SectionCard
      as="section"
      aria-label={eyebrow}
      className={`print:hidden flex flex-col gap-4 md:flex-row md:items-center md:gap-8 ${className}`}
    >
      <div className="min-w-0 flex-1">
        <p className={groupLabelClass("primary")}>{eyebrow}</p>
        <h2 className="mt-1 text-lg font-medium text-pretty">{card.title}</h2>
        {card.summary ? (
          <p className="mt-1 line-clamp-2 text-sm text-muted">{card.summary}</p>
        ) : null}
        <p className="mt-2 text-sm tabular-nums">{card.facts}</p>
      </div>
      <Link href={card.href} className={buttonClass({ variant: "primary", className: "md:px-8" })}>
        {card.cta}
      </Link>
    </SectionCard>
  );
}
