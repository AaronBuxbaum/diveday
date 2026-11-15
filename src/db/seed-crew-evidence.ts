import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { staffCredentials } from "./schema";
import type { SeedRollCallEvidenceInput } from "./seed-roll-call-evidence";

/** Attach explicitly fictional credential facts to newly authored demo fixtures only. */
export async function withDemoCrewEvidence(
  db: DbExecutor,
  shopId: string,
  events: readonly SeedRollCallEvidenceInput[],
): Promise<SeedRollCallEvidenceInput[]> {
  if (events.some((event) => event.shopId !== shopId)) throw new Error("Mixed demo shops");
  const ids = [
    ...new Set(events.flatMap((event) => (event.crewPersonId ? [event.crewPersonId] : []))),
  ];
  if (ids.length === 0) return [...events];
  const credentials = await db
    .select({
      personId: staffCredentials.personId,
      kind: staffCredentials.kind,
      issuedAt: staffCredentials.issuedAt,
      renewsAt: staffCredentials.renewsAt,
      identifier: staffCredentials.identifier,
      reviewNote: staffCredentials.reviewNote,
    })
    .from(staffCredentials)
    .where(
      and(
        eq(staffCredentials.shopId, shopId),
        inArray(staffCredentials.personId, ids),
        eq(staffCredentials.status, "verified"),
        isNull(staffCredentials.deletedAt),
      ),
    )
    // Generated row IDs differ across demo resets. Order by the facts copied
    // into evidence so a reset does not change the same fictional snapshot.
    .orderBy(
      asc(staffCredentials.kind),
      asc(staffCredentials.issuedAt),
      asc(staffCredentials.renewsAt),
    );
  return events.map((event) => {
    if (
      event.subjectKind !== "crew" ||
      !event.crewPersonId ||
      event.source !== "live" ||
      event.checkpoint !== "departure" ||
      event.status !== "boarded" ||
      event.credentialSnapshot != null
    )
      return event;
    const snapshot = credentials
      .filter(
        (credential) =>
          credential.personId === event.crewPersonId &&
          credential.identifier?.startsWith(`DEMO-${event.crewPersonId}-`) &&
          credential.reviewNote ===
            "Fictional demo credential; no real credential or policy is represented.",
      )
      .map(({ kind, issuedAt, renewsAt }) => ({ kind, issuedAt, renewsAt }));
    if (snapshot.length === 0) return event;
    return {
      ...event,
      credentialSnapshot: snapshot,
      credentialSnapshotStartedAt: event.occurredAt,
      credentialSnapshotCapturedAt: event.occurredAt,
    };
  });
}
