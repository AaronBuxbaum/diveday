import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { EmptyState } from "@/components/EmptyState";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { LedgerGroup } from "@/components/ui/ledger";
import { requireShopSurface } from "@/features/session";
import { getPastDay, pastDayStationNotes } from "@/features/today";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone, formatCalendarDate, isShopDayParam } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { formatWeekday } from "@/lib/format";
import { shopPath } from "@/lib/staff-notices";
import { shopDaysBounds } from "@/lib/zoned";
import { ClosingStation } from "../../../_components/today/ClosingStation";

// The staff family's contract (ADR 20260804-instant-navigation): this
// segment's `loading.tsx` paints first, and nothing above it reads the request.
export const instant = true;

export const metadata: Metadata = {
  title: "A day on the water — DiveDay",
};

/**
 * **A past day, read-only** (issue #2662): "how did Saturday go". The day's
 * departures as the home's evening closed them — the same `getDayCloseout`
 * over that date, the same settled stations — and nothing to do on any of
 * them: no recap editor, no takings, no tomorrow. Under Schedule, beside the
 * board. Today is the shop home, so today's date goes there; a day still to
 * come has no close-out and no page.
 *
 * Every staff member may read it, as every staff member reads the home's
 * evening; the departure log is read from trip Details.
 */
export default async function PastDayPage({
  params,
}: {
  params: Promise<{ shopSlug: string; date: string }>;
}) {
  const { shopSlug, date } = await params;
  if (!isShopDayParam(date)) notFound();
  const { db, shop } = await requireShopSurface(shopSlug);
  const now = nowDate();
  const today = calendarDateInTimezone(now, shop.timezone);
  if (date === today) redirect(shopPath(shopSlug));
  if (date > today) notFound();
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);

  // Both per-trip readers answer an empty map for no trips, so an empty day reads nothing.
  const { stations, headCountCloses, notBack } = await getPastDay(db, shop, date, now);
  // What a day read later must say that the evening could leave unsaid. The
  // departure log stays the record; these lines only point at it.
  const stationNotes = (station: (typeof stations)[number]) => {
    const headCountClose = headCountCloses.get(station.tripId) ?? null;
    const notes = pastDayStationNotes({
      close: station,
      day: date,
      timeZone: shop.timezone,
      closedAt: headCountClose?.closedAt ?? null,
      notBackDive: notBack.get(station.tripId) ?? null,
    });
    return {
      headCountClose,
      countedLaterOn: notes.countedLaterOn
        ? formatCalendarDate(notes.countedLaterOn, locale)
        : undefined,
      notes: [
        ...(notes.crewNotCounted ? [t("closeout.pastDay.crewNotCounted")] : []),
        ...(notes.notBackDive !== null
          ? [t("closeout.pastDay.resolvedNotBack", { dive: notes.notBackDive })]
          : []),
      ],
    };
  };

  return (
    <StaffPage width="full">
      <ShopPageHeader
        eyebrow={t("shared.shopNavLinks.board")}
        title={formatCalendarDate(date, locale)}
        meta={
          <span className="text-sm text-muted">
            {formatWeekday(shopDaysBounds(date, date, shop.timezone).from, locale, shop.timezone)}
          </span>
        }
      />
      {stations.length === 0 ? (
        <EmptyState title={t("closeout.pastDay.empty")} className="mt-8" />
      ) : (
        <LedgerGroup as="h2" label={t("shopHome.spine.departuresLabel")} className="mt-8">
          <ol className="flex flex-col gap-5">
            {stations.map((station) => (
              <ClosingStation
                key={station.tripId}
                close={station}
                {...stationNotes(station)}
                shopSlug={shopSlug}
                locale={locale}
                timeZone={shop.timezone}
                t={t}
              />
            ))}
          </ol>
        </LedgerGroup>
      )}
    </StaffPage>
  );
}
