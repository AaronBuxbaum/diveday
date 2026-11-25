import Link from "next/link";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { shopPath } from "@/lib/staff-notices";
import { diveLogHash } from "../TripDiveRecord";
import { QUIET_ACTION } from "../trip-ink";

/** Links only to disclosures drawn on this Wrapped up page. */
export function WrappedRecordLinks({
  dives,
  sightingsEnabled,
  sightingDives,
  shopSlug,
  tripId,
  lostFoundEnabled,
  t,
}: {
  dives: number[];
  sightingsEnabled: boolean;
  sightingDives: number[];
  shopSlug: string;
  tripId: string;
  lostFoundEnabled: boolean;
  t: StaffTranslator;
}) {
  if (
    (!sightingsEnabled || (dives.length === 0 && sightingDives.length === 0)) &&
    !lostFoundEnabled
  )
    return null;
  return (
    <nav aria-label={t("trips.clock.wrapped.records")} className="flex flex-wrap gap-x-6 gap-y-2">
      {sightingsEnabled
        ? dives.map((dive) => (
            <Link key={dive} href={diveLogHash(dive)} className={QUIET_ACTION}>
              {t("trips.clock.wrapped.diveSpecies", { dive })}
            </Link>
          ))
        : null}
      {/* A document navigation lets the browser reveal the existing closed deck disclosure. */}
      {sightingsEnabled
        ? sightingDives.map((dive) => (
            <a
              key={`seen-${dive}`}
              href={`${shopPath(shopSlug, "trips", tripId, "manifest")}?checkpoint=after_dive_${dive}#seen-heading`}
              className={QUIET_ACTION}
            >
              {t("trips.clock.wrapped.diveSightings", { dive })}
            </a>
          ))
        : null}
      {lostFoundEnabled ? (
        <Link href="#found-aboard" className={QUIET_ACTION}>
          {t("desk.lostFound.heading")}
        </Link>
      ) : null}
    </nav>
  );
}
