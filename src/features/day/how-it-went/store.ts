import { canPersonExportIncidentRecord } from "@/db/authz";
import type { AppDb } from "@/db/client";
import { listCountedAboardBlockedByTrip } from "@/db/manifests";
import { rentalFitByBooking } from "@/db/rental-fit";
import { getIncidentExport } from "@/features/safety/incident-export";
import { nowDate } from "@/lib/clock";
import { shopDayBounds } from "@/lib/zoned";
import { type HowItWent, howItWent } from "./rules";

export type HowItWentMeta = {
  shopName: string;
  tripTitle: string;
  tripStartsAt: string;
  timezone: string;
  boatName: string | null;
};

/**
 * **How it went, for one departure** (glossary): the owner's short account,
 * composed by `howItWent` (src/features/day/how-it-went/rules.ts) from the departure log's
 * own document, the readiness each boarding mark kept, and when each seat's
 * rental fit was stated. The gate is the departure log's (owner-only,
 * checked against the database), because it reads the same record.
 *
 * `page` is null for another shop's trip: tenancy is the caller's shop.
 */
export async function getHowItWentPage(
  db: AppDb,
  shopId: string,
  tripId: string,
  personId: string,
  now: Date = nowDate(),
): Promise<
  { allowed: false } | { allowed: true; page: { meta: HowItWentMeta; recap: HowItWent } | null }
> {
  if (!(await canPersonExportIncidentRecord(db, shopId, personId))) return { allowed: false };
  const [doc, blocked, fits] = await Promise.all([
    getIncidentExport(db, shopId, tripId, personId, now),
    listCountedAboardBlockedByTrip(db, shopId, [tripId]),
    rentalFitByBooking(db, shopId, tripId),
  ]);
  if (!doc) return { allowed: true, page: null };
  const recap = howItWent({
    checkpoints: doc.meta.checkpoints,
    roster: doc.roster,
    crew: doc.crew,
    turnedAway: doc.turnedAway,
    executedDives: doc.executedDives,
    countedAboardBlocked: blocked.get(tripId) ?? new Map(),
    fitStatedAt: new Map(
      [...fits].map(([bookingId, fit]) => [bookingId, fit?.fitStatedAt ?? null]),
    ),
    day: shopDayBounds(new Date(doc.meta.tripStartsAt), doc.meta.timezone),
  });
  return {
    allowed: true,
    page: {
      meta: {
        shopName: doc.meta.shopName,
        tripTitle: doc.meta.tripTitle,
        tripStartsAt: doc.meta.tripStartsAt,
        timezone: doc.meta.timezone,
        boatName: doc.boatSafety?.boatName ?? null,
      },
      recap,
    },
  };
}
