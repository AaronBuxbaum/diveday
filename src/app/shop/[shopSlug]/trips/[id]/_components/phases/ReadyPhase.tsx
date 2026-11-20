import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "@/components/ui/button";
import { shopPath } from "@/lib/staff-notices";
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
}: {
  record: PhaseRecordContext;
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
    <div data-phase-panel="ready" className="space-y-6">
      {guests}
      <p>
        <Link
          className={buttonClass({ variant: "link", flush: true })}
          href={`${shopPath(shop.slug, "trips", tripId)}?phase=checkin`}
        >
          {t("trips.clock.ready.paperPasses")}
        </Link>
      </p>
      {prep}
      {buddies}
    </div>
  );
}
