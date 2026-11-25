import Link from "next/link";
import type { ReactNode } from "react";
import { MoreMenu } from "@/components/MoreMenu";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { menuRowClass } from "@/components/ui/menu";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatShortDate, formatTimeTz } from "@/lib/format";
import { tripPacketPath } from "@/lib/print-sheets";
import { shopPath } from "@/lib/staff-notices";
import { startIncidentReportAction } from "../incidents/actions";
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
 * facts line, then **Edit trip** and **More**, with **Roll call** as a quiet
 * link where it is not the phase's hero. More holds what has no other home
 * yet: adding a guest, Gear, the printed packet, Activity, Roll call before
 * Check-in, and last **Report an incident**, the one door on the departure
 * that starts a report, reachable in every phase. On a phone Edit trip moves
 * into More.
 */
export function TripHeader({
  trip,
  facts,
  shopSlug,
  tripId,
  rollCall,
  addGuest,
  reportIncident,
  locale,
  timeZone,
  t,
}: {
  trip: { title: string; startsAt: Date; endsAt: Date };
  facts: readonly string[];
  shopSlug: string;
  tripId: string;
  /**
   * Where Roll call's door is: in More before Check-in, the phase's own hero
   * at Check-in and On the water, and a quiet link here everywhere else.
   */
  rollCall: "more" | "header" | "hero";
  /** The trip still sells a seat: More offers the add band (`?add=1`). */
  addGuest: boolean;
  /** This viewer may start an incident report here (`mayStartTripIncidentReport`); the write re-checks. */
  reportIncident: boolean;
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
      stackActionsOnPhone={rollCall === "header"}
      actions={
        <>
          {rollCall === "header" ? (
            <Link
              href={`${root}/manifest`}
              data-roll-call-door=""
              // Flush: on a phone it leads its own row, under the title's edge.
              className={buttonClass({ variant: "ghost", size: "sm", flush: true })}
            >
              {t("trips.clock.rollCall")}
            </Link>
          ) : null}
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
            {rollCall === "more" ? (
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
            {reportIncident ? (
              <form action={startIncidentReportAction.bind(null, shopSlug, tripId)}>
                <SubmitButton pendingLabel={t("words.busy.opening")} className={row}>
                  {t("trips.clock.reportIncident")}
                </SubmitButton>
              </form>
            ) : null}
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
