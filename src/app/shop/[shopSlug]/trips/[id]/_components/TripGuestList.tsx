import type { ComponentProps, ReactNode } from "react";
import type { TripOverview } from "@/features/trips/trip-overview";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { CoursePulse } from "./CoursePulse";
import { DeskRefresh } from "./DeskRefresh";
import { GuestBands } from "./GuestBands";

/**
 * **The guest list as every phase hosts it** (ADR 20261117-trip-page-clock):
 * the bands, a course's pulse, then the roster as that phase's fix list,
 * under the desk's pull to refresh while arrivals are open.
 */
export function TripGuestList({
  deskOpen,
  overview,
  showMinimum,
  coursePulse,
  shopSlug,
  tripId,
  locale,
  timeZone,
  t,
  roster,
}: {
  deskOpen: boolean;
  overview: NonNullable<TripOverview>;
  showMinimum: boolean;
  coursePulse: ComponentProps<typeof CoursePulse>["pulse"];
  shopSlug: string;
  tripId: string;
  locale: string;
  timeZone: string;
  t: StaffTranslator;
  roster: ReactNode;
}) {
  return (
    <DeskRefresh
      open={deskOpen}
      copy={{
        pulling: t("checkIn.pullToRefresh.pulling"),
        release: t("checkIn.pullToRefresh.release"),
        refreshing: t("checkIn.pullToRefresh.refreshing"),
      }}
    >
      {/* `empty:hidden`: with no band and no course pulse, an empty box would
          still take the stack's gap above the guest list. */}
      <div className="space-y-6 empty:hidden">
        <GuestBands {...{ overview, showMinimum, shopSlug, locale, timeZone, t }} />
        <CoursePulse
          shopSlug={shopSlug}
          pulse={coursePulse}
          tripId={tripId}
          locale={locale}
          timeZone={timeZone}
        />
      </div>
      {roster}
    </DeskRefresh>
  );
}
