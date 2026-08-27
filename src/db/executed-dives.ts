import { and, asc, eq, isNull } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { AppDb, DbExecutor } from "./client";
import { diveSites, executedDives, people, tripDives, trips } from "./schema";
import { liveTrip } from "./trips-live";

export type ExecutedDiveInput = {
  shopId: string;
  tripId: string;
  diveNumber: number;
  actualSiteId?: string | null;
  enteredAt?: Date | null;
  exitedAt?: Date | null;
  maxDepthMeters?: number | null;
  observedConditions?: Record<string, unknown> | null;
  notRecorded?: string[];
  recordedByPersonId: string;
};

export async function listExecutedDives(db: DbExecutor, shopId: string, tripId: string) {
  return db
    .select({
      executed: executedDives,
      actualSite: diveSites,
      recorder: { id: people.id, name: people.fullName },
    })
    .from(executedDives)
    .innerJoin(trips, eq(trips.id, executedDives.tripId))
    .leftJoin(diveSites, eq(diveSites.id, executedDives.actualSiteId))
    .leftJoin(people, eq(people.id, executedDives.recordedByPersonId))
    .where(
      and(
        eq(executedDives.shopId, shopId),
        eq(executedDives.tripId, tripId),
        eq(trips.shopId, shopId),
        liveTrip(),
        isNull(executedDives.deletedAt),
      ),
    )
    .orderBy(asc(executedDives.diveNumber));
}

/**
 * Why a dive log entry was refused.
 *
 * This used to be a bare `null` for all five conditions, and the surface above
 * it swallowed that too — so a divemaster who typed 14:35 in and 14:05 out (a
 * transposition, at the rail, one-handed) got no message, an empty form, and
 * every reason to believe it had saved. What is written here is what
 * `buildIncidentExport` later reads into a sealed document for an investigator
 * or a treating physician, and a dive that silently failed to save is a hole in
 * that document nobody knows is there (issue #1018).
 */
export type ExecutedDiveRefusal =
  | "unknown_trip"
  | "dive_number_out_of_range"
  | "unknown_recorder"
  | "unknown_site"
  | "times_transposed"
  | "depth_out_of_range";

export type UpsertExecutedDiveResult =
  | { ok: true; dive: typeof executedDives.$inferSelect }
  | { ok: false; reason: ExecutedDiveRefusal };

export async function upsertExecutedDive(
  db: AppDb,
  input: ExecutedDiveInput,
): Promise<UpsertExecutedDiveResult> {
  return db.transaction(async (tx): Promise<UpsertExecutedDiveResult> => {
    const [trip] = await tx
      .select({ plannedDives: trips.plannedDives })
      .from(trips)
      .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
      .limit(1);
    if (!trip) return { ok: false, reason: "unknown_trip" };
    if (input.diveNumber < 1 || input.diveNumber > trip.plannedDives) {
      return { ok: false, reason: "dive_number_out_of_range" };
    }
    const [recorder] = await tx
      .select({ id: people.id })
      .from(people)
      .where(
        and(
          eq(people.id, input.recordedByPersonId),
          eq(people.shopId, input.shopId),
          isNull(people.deletedAt),
        ),
      )
      .limit(1);
    if (!recorder) return { ok: false, reason: "unknown_recorder" };
    let actualSiteId = input.actualSiteId;
    if (actualSiteId === undefined) {
      const [planned] = await tx
        .select({ diveSiteId: tripDives.diveSiteId })
        .from(tripDives)
        .where(and(eq(tripDives.tripId, input.tripId), eq(tripDives.diveNumber, input.diveNumber)))
        .limit(1);
      actualSiteId = planned?.diveSiteId ?? null;
    }
    if (actualSiteId) {
      const [site] = await tx
        .select({ id: diveSites.id })
        .from(diveSites)
        .where(
          and(
            eq(diveSites.id, actualSiteId),
            eq(diveSites.shopId, input.shopId),
            isNull(diveSites.deletedAt),
          ),
        )
        .limit(1);
      if (!site) return { ok: false, reason: "unknown_site" };
    }
    if (input.enteredAt && input.exitedAt && input.exitedAt <= input.enteredAt) {
      return { ok: false, reason: "times_transposed" };
    }
    if (
      input.maxDepthMeters != null &&
      (!Number.isFinite(input.maxDepthMeters) || input.maxDepthMeters < 0)
    ) {
      return { ok: false, reason: "depth_out_of_range" };
    }
    const values = {
      shopId: input.shopId,
      tripId: input.tripId,
      diveNumber: input.diveNumber,
      actualSiteId,
      enteredAt: input.enteredAt ?? null,
      exitedAt: input.exitedAt ?? null,
      maxDepthMeters: input.maxDepthMeters ?? null,
      observedConditions: input.observedConditions
        ? Object.fromEntries(
            Object.entries(input.observedConditions).filter(
              ([key, value]) =>
                (key === "visibility" || key === "current") &&
                typeof value === "string" &&
                value.length <= 120,
            ),
          )
        : null,
      notRecorded: [...new Set(input.notRecorded ?? [])].filter((value) => value === "depth"),
      recordedByPersonId: recorder.id,
      updatedAt: nowDate(),
    };
    // One statement, not select-then-insert. Two divemasters writing the same
    // dive number at the rail is a real sequence, and the select this replaced
    // was not a lock: the loser hit `executed_dives_trip_number_live_unique`
    // and escaped as a 500 on the manifest. `on conflict` targets that partial
    // index directly, so the second write lands on the first one's row instead
    // of racing it -- and needs no savepoint, which catching the violation
    // inside this transaction would have (see `rewindowTripGearReservations`).
    const [row] = await tx
      .insert(executedDives)
      .values(values)
      .onConflictDoUpdate({
        target: [executedDives.tripId, executedDives.diveNumber],
        targetWhere: isNull(executedDives.deletedAt),
        set: values,
      })
      .returning();
    // The upsert targets a partial unique index and always writes a row; a
    // missing one is not a refusal anyone can act on, so it stays the
    // unknown-trip answer rather than inventing a sixth reason.
    return row ? { ok: true, dive: row } : { ok: false, reason: "unknown_trip" };
  });
}

export async function deleteExecutedDive(
  db: DbExecutor,
  input: { shopId: string; tripId: string; diveNumber: number; deletedByPersonId: string },
) {
  const [row] = await db
    .update(executedDives)
    .set({ deletedAt: nowDate(), deletedByPersonId: input.deletedByPersonId, updatedAt: nowDate() })
    .where(
      and(
        eq(executedDives.shopId, input.shopId),
        eq(executedDives.tripId, input.tripId),
        eq(executedDives.diveNumber, input.diveNumber),
        isNull(executedDives.deletedAt),
      ),
    )
    .returning({ id: executedDives.id });
  return Boolean(row);
}
