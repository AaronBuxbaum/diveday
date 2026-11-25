import type { ReactNode } from "react";
import { listTripIncidentReports } from "@/db/incident-reports";
import type { PhaseRecordContext } from "./WaterPhase";
import { IncidentsLine } from "./WrappedPanels";

/**
 * **Check-in** (ADR 20261117-trip-page-clock): the front desk's phase on the
 * day, until the boat leaves. The guest list with the arrival desk, then the
 * quiet line: gear, crew, the water and roll call next.
 */
export async function CheckInPhase({
  guests,
  quiet,
  buddies,
  record,
}: {
  record: PhaseRecordContext;
  guests: ReactNode;
  quiet: ReactNode;
  /** Buddy teams, for a shop that runs them (`BuddyTeamsCard`). */
  buddies: ReactNode;
}) {
  const { context, tripId, t } = record;
  const { db, shop, session } = context;
  const incidents = await listTripIncidentReports(db, shop.id, tripId, session.user.personId);
  return (
    <div data-phase-panel="checkin" className="space-y-6 sm:space-y-10">
      {guests}
      {quiet}
      <IncidentsLine incidents={incidents} shopSlug={shop.slug} tripId={tripId} t={t} />
      {buddies}
    </div>
  );
}
