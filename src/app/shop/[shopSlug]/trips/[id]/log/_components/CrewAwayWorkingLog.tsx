import type { DbExecutor } from "@/db/client";
import { listCrewAwayAcknowledgements } from "@/db/crew-away-acknowledgements";
import type { StaffTranslator } from "@/i18n/staff-messages";

/**
 * **Who was away and said to be working it anyway** (issue #2678, records
 * review S2), under the log's crew table: "Marcus Webb was away; acknowledged
 * by Dana Ortiz at 07:12." Beside the sealed facts, never inside them, so a
 * printed log's code is unchanged. Nothing renders when nobody was.
 */
export async function CrewAwayWorkingLog({
  db,
  shopId,
  tripId,
  t,
  dateTime,
}: {
  db: DbExecutor;
  /** The session's shop: tenancy is never the URL's. */
  shopId: string;
  tripId: string;
  t: StaffTranslator;
  /** The page's own instant formatter, in the shop's zone. */
  dateTime: (isoString: string) => string;
}) {
  const entries = await listCrewAwayAcknowledgements(db, shopId, tripId);
  return entries.map((entry) => (
    <p key={entry.personId} className="mt-2 text-sm">
      {entry.acknowledgedByName
        ? t("incidentExport.crewAwayAcknowledged", {
            name: entry.fullName,
            by: entry.acknowledgedByName,
            time: dateTime(entry.acknowledgedAt.toISOString()),
          })
        : t("incidentExport.crewAwayAcknowledgedNoActor", {
            name: entry.fullName,
            time: dateTime(entry.acknowledgedAt.toISOString()),
          })}
    </p>
  ));
}
