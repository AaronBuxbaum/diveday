import { and, asc, eq, gte, inArray, isNull, lte, ne } from "drizzle-orm";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { rollCallCheckpoints } from "@/lib/manifests";
import { hasReturned } from "@/lib/trips";
import { shopMonthBounds, utcToWallTime } from "@/lib/zoned";
import type { DbExecutor } from "../client";
import { crewWithScheduledShifts } from "../crew-shift-scheduling";
import { crewMarks } from "../roll-call-subject";
import {
  crewAvailabilityBlocks,
  people,
  personRoles,
  rollCallEvents,
  tripAssignments,
  trips,
} from "../schema";
import { crewBusyElsewhere } from "../trips-crew";
import { liveTrip } from "../trips-live";
import { withDemoCrewEvidence } from "./crew-evidence";
import { type SeedRollCallEvidenceInput, seedRollCallEvidence } from "./roll-call-evidence";

/** Populate the demo's historical crew and their fictional boarding evidence. */
export async function seedHistoryCrew(
  db: DbExecutor,
  shopId: string,
  timeZone: string,
  initialStaffRota: boolean,
  visitingCrew: readonly {
    personId: string;
    tripRole: "crew" | "instructor";
    staffRole: "owner" | "instructor";
  }[],
) {
  const readHistory = () =>
    db
      .select({
        tripId: trips.id,
        startsAt: trips.startsAt,
        endsAt: trips.endsAt,
        plannedDives: trips.plannedDives,
        personId: tripAssignments.personId,
      })
      .from(trips)
      .innerJoin(tripAssignments, eq(tripAssignments.tripId, trips.id))
      .where(
        and(
          liveTrip(),
          eq(trips.shopId, shopId),
          eq(trips.description, "Sailed. Kept in the log for the shop's monthly numbers."),
        ),
      )
      .orderBy(asc(trips.startsAt), asc(trips.title), asc(trips.id));
  let history = await readHistory();
  if (history.length === 0) return;
  const now = nowDate();
  const today = utcToWallTime(now, timeZone);
  const { from, to } = shopMonthBounds({ year: today.year, month: today.month }, timeZone);
  const boats = [...new Map(history.map((row) => [row.tripId, row])).values()].filter(
    (row) => row.startsAt >= from && row.startsAt < to && hasReturned(row.endsAt, now),
  );
  for (const visitor of visitingCrew) {
    const [active] = await db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(
        and(
          eq(people.shopId, shopId),
          eq(people.id, visitor.personId),
          eq(personRoles.role, visitor.staffRole),
          isNull(people.deletedAt),
          isNull(people.anonymizedAt),
        ),
      )
      .limit(1);
    if (
      !active ||
      boats.some((boat) =>
        history.some((row) => row.tripId === boat.tripId && row.personId === visitor.personId),
      )
    )
      continue;
    for (const boat of boats) {
      // On a fresh seed the rota is built after the trips; a reset keeps it.
      const busy = await crewBusyElsewhere(db, shopId, boat.tripId, [visitor.personId], [boat]);
      if (busy.size > 0) continue;
      const covered = initialStaffRota
        ? true
        : (await crewWithScheduledShifts(db, shopId, [boat], [visitor.personId])).has(
            visitor.personId,
          );
      if (!covered) continue;
      const [away] = await db
        .select({ id: crewAvailabilityBlocks.id })
        .from(crewAvailabilityBlocks)
        .where(
          and(
            eq(crewAvailabilityBlocks.shopId, shopId),
            eq(crewAvailabilityBlocks.personId, visitor.personId),
            isNull(crewAvailabilityBlocks.deletedAt),
            ne(crewAvailabilityBlocks.status, "declined"),
            lte(crewAvailabilityBlocks.startsOn, calendarDateInTimezone(boat.endsAt, timeZone)),
            gte(crewAvailabilityBlocks.endsOn, calendarDateInTimezone(boat.startsAt, timeZone)),
          ),
        )
        .limit(1);
      if (away) continue;
      await db.insert(tripAssignments).values({
        tripId: boat.tripId,
        personId: visitor.personId,
        tripRole: visitor.tripRole,
      });
      history = await readHistory();
      break;
    }
  }
  const existing = await db
    .select({ tripId: rollCallEvents.tripId, personId: rollCallEvents.crewPersonId })
    .from(rollCallEvents)
    .where(
      and(
        eq(rollCallEvents.shopId, shopId),
        crewMarks(),
        inArray(rollCallEvents.tripId, [...new Set(history.map(({ tripId }) => tripId))]),
      ),
    );
  const marked = new Set(existing.map(({ tripId, personId }) => `${tripId}:${personId}`));
  const events: SeedRollCallEvidenceInput[] = history.flatMap((row) => {
    if (marked.has(`${row.tripId}:${row.personId}`)) return [];
    return rollCallCheckpoints(row.plannedDives).map((checkpoint, index) => {
      const occurredAt = new Date(row.startsAt.getTime() + index * 90 * 60 * 1000);
      return {
        shopId,
        tripId: row.tripId,
        subjectKind: "crew" as const,
        crewPersonId: row.personId,
        recordedByPersonId: row.personId,
        status: "boarded" as const,
        checkpoint,
        source: "live" as const,
        occurredAt,
        createdAt: occurredAt,
      };
    });
  });
  if (events.length === 0) return;
  await seedRollCallEvidence(
    db,
    await withDemoCrewEvidence(db, shopId, events, { historicalTimeZone: timeZone }),
    { observesPrevious: false },
  );
}
