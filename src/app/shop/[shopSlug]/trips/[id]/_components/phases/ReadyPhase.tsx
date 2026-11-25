import Link from "next/link";
import type { ReactNode } from "react";
import { shopPath } from "@/lib/staff-notices";
import { QUIET_ACTION } from "../trip-ink";
import type { PhaseRecordContext } from "./WaterPhase";

/**
 * **Getting ready** (ADR 20261117-trip-page-clock): the front desk's phase,
 * from shop-local midnight of the day before. The fix list with its remote
 * remedies, then gear to pack and tomorrow's water.
 */
export function ReadyPhase({
  guests,
  prep,
  buddies,
  record,
  deskOpen,
}: {
  record: PhaseRecordContext;
  deskOpen: boolean;
  guests: ReactNode;
  prep: ReactNode;
  /** Buddy teams, for a shop that runs them (`BuddyTeamsCard`). */
  buddies: ReactNode;
}) {
  const {
    context: { shop },
    tripId,
    t,
  } = record;
  return (
    <div data-phase-panel="ready" className="space-y-6 sm:space-y-10">
      {guests}
      <p>
        {deskOpen ? (
          <Link
            className={QUIET_ACTION}
            href={`${shopPath(shop.slug, "trips", tripId)}?phase=checkin`}
          >
            {t("trips.clock.ready.paperPasses")}
          </Link>
        ) : (
          t("trips.clock.ready.paperPassesUnavailable")
        )}
      </p>
      {prep}
      {buddies}
    </div>
  );
}
