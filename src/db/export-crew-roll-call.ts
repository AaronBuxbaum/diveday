import { EXPORT_FILE_NOTES } from "@/lib/export";
import type { ShopExportContext } from "./export";
import type { ExportFileSpec } from "./export-tables";

/** Crew marks and the optional interval-bounded live credential observation. */
export const CREW_ROLL_CALL_CSV: ExportFileSpec<ShopExportContext> = {
  file: "roll_call_crew_events.csv",
  header: [
    "id",
    "trip_id",
    "trip_title",
    "trip_starts_at",
    "person_id",
    "person_name",
    "status",
    "checkpoint",
    "source",
    "client_event_id",
    "recorded_by_person_id",
    "recorded_by_name",
    "note",
    "credential_snapshot",
    "credential_snapshot_started_at",
    "credential_snapshot_captured_at",
    "occurred_at",
    "created_at",
  ],
  rows: ({ personName, tripTitle, tripStartsAt, crewRollCallRows }) =>
    crewRollCallRows.map((row) => [
      row.id,
      row.tripId,
      tripTitle.get(row.tripId),
      tripStartsAt.get(row.tripId),
      row.personId,
      personName.get(row.personId),
      row.status,
      row.checkpoint,
      row.source,
      row.clientEventId,
      row.recordedByPersonId,
      personName.get(row.recordedByPersonId),
      row.note,
      row.credentialSnapshot === null ? null : JSON.stringify(row.credentialSnapshot),
      row.credentialSnapshotStartedAt,
      row.credentialSnapshotCapturedAt,
      row.occurredAt,
      row.createdAt,
    ]),
  note: EXPORT_FILE_NOTES["roll_call_crew_events.csv"],
};
