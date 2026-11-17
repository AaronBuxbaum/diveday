import Link from "next/link";
import type { ReactNode } from "react";
import { MoreMenu } from "@/components/MoreMenu";
import { buttonClass } from "@/components/ui/button";
import { menuRowClass } from "@/components/ui/menu";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatShortDate, formatTimeTz } from "@/lib/format";
import { tripPacketPath } from "@/lib/print-sheets";
import { shopPath } from "@/lib/staff-notices";
import { TripPageHeader } from "./TripPageHeader";

/**
 * The trip's facts line: date, time with its zone, boat, and where to meet.
 * A run that meets on several days says its span in place of the first day.
 */
export function tripFacts({
  trip,
  daySpan,
  boatName,
  meetingPlace,
  locale,
  timeZone,
}: {
  trip: { startsAt: Date };
  daySpan?: string;
  boatName?: string | null;
  meetingPlace?: string | null;
  locale: string;
  timeZone: string;
}): string[] {
  const when = daySpan
    ? [daySpan]
    : [
        formatShortDate(trip.startsAt, locale, timeZone),
        formatTimeTz(trip.startsAt, locale, timeZone),
      ];
  return [...when, boatName, meetingPlace].filter((part): part is string => Boolean(part));
}

/**
 * **The Trip page's header** (ADR 20261117-trip-page-clock): the title, one
 * facts line, then **Edit trip** and **More**. More holds what has no other
 * home yet: adding a guest, Gear, the printed packet, Activity, and Roll call
 * before the phase that opens its door. On a phone Edit trip moves into More.
 */
export function TripHeader({
  trip,
  facts,
  shopSlug,
  tripId,
  rollCallInMore,
  addGuest,
  locale,
  timeZone,
  t,
}: {
  trip: { title: string; startsAt: Date; endsAt: Date };
  facts: readonly string[];
  shopSlug: string;
  tripId: string;
  /** Roll call has no door on the page yet (before Check-in): More carries it. */
  rollCallInMore: boolean;
  /** The trip still sells a seat: More offers the add band (`?add=1`). */
  addGuest: boolean;
  locale: string;
  timeZone: string;
  t: StaffTranslator;
}) {
  const root = shopPath(shopSlug, "trips", tripId);
  const row = menuRowClass("quiet", { gutter: false });
  return (
    <TripPageHeader
      trip={trip}
      locale={locale}
      timeZone={timeZone}
      facts={facts}
      // The page's own `space-y` spaces it; a margin here would override that gap.
      className=""
      actions={
        <>
          <span className="hidden sm:contents">
            <Link
              href={`${root}?view=edit`}
              className={buttonClass({ variant: "ghost", size: "sm" })}
            >
              {t("trips.clock.editTrip")}
            </Link>
          </span>
          <MoreMenu label={t("trips.clock.more")} size="sm">
            <span className="contents sm:hidden">
              <MenuLink href={`${root}?view=edit`} className={row}>
                {t("trips.clock.editTrip")}
              </MenuLink>
            </span>
            {addGuest ? (
              <MenuLink href={`${root}?add=1`} className={row}>
                {t("trips.clock.addGuest")}
              </MenuLink>
            ) : null}
            {rollCallInMore ? (
              <MenuLink href={`${root}/manifest`} className={row}>
                {t("trips.clock.rollCall")}
              </MenuLink>
            ) : null}
            <MenuLink href={`${root}/prep`} className={row}>
              {t("trips.clock.gear")}
            </MenuLink>
            <a
              href={tripPacketPath(shopSlug, tripId)}
              target="_blank"
              rel="noreferrer"
              className={row}
            >
              {t("trips.clock.printPacket")}
            </a>
            <MenuLink href={`${root}?phase=wrapped#trip-activity`} className={row}>
              {t("trips.clock.activity")}
            </MenuLink>
          </MoreMenu>
        </>
      }
    />
  );
}

function MenuLink({
  href,
  className,
  children,
}: {
  href: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
