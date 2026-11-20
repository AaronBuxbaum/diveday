import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { EmptyState } from "@/components/EmptyState";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { LedgerGroup } from "@/components/ui/ledger";
import { ShopNotice } from "@/components/ui/outcome";
import { collisionsFor, getBoatDay } from "@/features/boat-day";
import { requireShopSurface } from "@/features/session";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import {
  calendarDateInTimezone,
  formatCalendarDate,
  isShopDayParam,
  shiftCalendarDate,
} from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { formatTime } from "@/lib/format";
import { ScheduleViews } from "../_components/ScheduleViews";

// The staff family's contract (ADR 20260804-instant-navigation): this segment's `loading.tsx`
// paints first, and nothing above it reads the request.
export const instant = true;

export const metadata: Metadata = {
  title: "Boats — DiveDay",
  robots: { index: false, follow: false },
};

/**
 * **One day across every boat** (issue #4258). Each boat's departures for the shop's day, with a
 * line under any departure that collides with another: a person crewing two boats at overlapping
 * hours, or one boat on two departures. It informs and never blocks; crew are set on the trip.
 */
export default async function BoatsDayPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  await connection();
  const { shopSlug } = await params;
  const { date: dateParam } = await searchParams;
  const { db, shop } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const today = calendarDateInTimezone(nowDate(), shop.timezone);
  const date = dateParam && isShopDayParam(dateParam) ? dateParam : today;
  const day = await getBoatDay(db, { shopId: shop.id, date, timeZone: shop.timezone });
  const dayHref = (target: string) => `/shop/${shopSlug}/schedule/boats?date=${target}`;

  const byBoat = new Map<string, { name: string; departures: typeof day.departures }>();
  for (const departure of day.departures) {
    const key = departure.boatId ?? "none";
    const group = byBoat.get(key) ?? {
      name: departure.boatName ?? t("schedule.boats.noBoat"),
      departures: [],
    };
    group.departures.push(departure);
    byBoat.set(key, group);
  }
  const titleOf = (tripId: string) =>
    day.departures.find((departure) => departure.tripId === tripId)?.title ?? "";
  const nameOf = (personId: string) =>
    day.departures.flatMap((d) => d.crew).find((member) => member.personId === personId)?.name ??
    "";
  const boatNameOf = (boatId: string) =>
    day.departures.find((departure) => departure.boatId === boatId)?.boatName ?? "";

  return (
    <StaffPage width="full">
      <ShopPageHeader
        eyebrow={t("schedule.boats.heading")}
        title={formatCalendarDate(date, locale)}
        meta={
          <span className="flex flex-wrap gap-2">
            <Link
              href={dayHref(shiftCalendarDate(date, -1))}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {t("schedule.boats.previousDay")}
            </Link>
            {date === today ? null : (
              <Link
                href={dayHref(today)}
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                {t("schedule.boats.today")}
              </Link>
            )}
            <Link
              href={dayHref(shiftCalendarDate(date, 1))}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {t("schedule.boats.nextDay")}
            </Link>
          </span>
        }
      />
      <ScheduleViews
        shopSlug={shopSlug}
        crewSchedule={shop.crewScheduleEnabled}
        current="boats"
        copy={{
          label: t("schedule.views.label"),
          week: t("schedule.views.week"),
          boats: t("schedule.views.boats"),
          crew: t("schedule.views.crew"),
          plan: t("schedule.views.plan"),
        }}
      />
      {day.departures.length === 0 ? (
        <EmptyState title={t("schedule.boats.empty")} className="mt-8" />
      ) : (
        <div className="mt-8 space-y-10">
          {[...byBoat.entries()].map(([key, group]) => (
            <LedgerGroup key={key} as="h2" label={group.name}>
              <ul className="flex flex-col gap-4">
                {group.departures.map((departure) => {
                  const clashes = collisionsFor(departure.tripId, day.collisions);
                  return (
                    <li key={departure.tripId}>
                      <Link
                        href={`/shop/${shopSlug}/trips/${departure.tripId}`}
                        className="font-semibold hover:underline"
                      >
                        {formatTime(departure.startsAt, locale, shop.timezone)} · {departure.title}
                      </Link>
                      <p className="text-sm text-muted">
                        {departure.crew.length > 0
                          ? departure.crew.map((member) => member.name).join(", ")
                          : t("schedule.boats.noCrew")}
                      </p>
                      {clashes.map((clash) => {
                        const otherId = clash.tripIds.find((id) => id !== departure.tripId) ?? "";
                        const names = {
                          first: titleOf(departure.tripId),
                          second: titleOf(otherId),
                        };
                        return (
                          <ShopNotice
                            key={`${clash.kind}-${otherId}-${clash.kind === "crew" ? clash.personId : clash.boatId}`}
                            tone="warning"
                            className="mt-2"
                          >
                            {clash.kind === "crew"
                              ? t("schedule.boats.crewClash", {
                                  name: nameOf(clash.personId),
                                  ...names,
                                })
                              : t("schedule.boats.boatClash", {
                                  boat: boatNameOf(clash.boatId),
                                  ...names,
                                })}
                          </ShopNotice>
                        );
                      })}
                    </li>
                  );
                })}
              </ul>
            </LedgerGroup>
          ))}
        </div>
      )}
    </StaffPage>
  );
}
