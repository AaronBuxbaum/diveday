import type { ComponentProps, ReactNode } from "react";
import type { TripOverview } from "@/features/trip-overview";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { CoursePulse } from "./CoursePulse";
import { DeskRefresh } from "./DeskRefresh";
import { GuestBands } from "./GuestBands";
import { PulseFacts } from "./PulseFacts";

/**
 * **The guest list as the phases host it for now** (ADR
 * 20261117-trip-page-clock): the bands, the pulse, a course's pulse, then the
 * roster, under the desk's pull to refresh while arrivals are open. Later
 * layers of the rebuild replace it phase by phase with the fix list.
 */
export function TripGuestList({
  deskOpen,
  overview,
  showMinimum,
  pulseFacts,
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
  pulseFacts: ComponentProps<typeof PulseFacts>["facts"];
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
      <div className="space-y-6">
        <GuestBands {...{ overview, showMinimum, shopSlug, locale, timeZone, t }} />
        <PulseFacts
          facts={pulseFacts}
          foldLabel={(count) => t("trips.pulse.needsYou", { count })}
        />
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
