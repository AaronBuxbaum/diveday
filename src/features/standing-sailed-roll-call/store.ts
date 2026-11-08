import { and, eq, exists, ne, notExists, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DbExecutor } from "../../db/client";
import { isNewerMark } from "../../db/roll-call-order";
import { crewMarks, seatMarks } from "../../db/roll-call-subject";
import { rollCallEvents, trips } from "../../db/schema/index";

/**
 * Whether the trip in the outer query has any **standing** roll-call result
 * that says someone sailed. This mirrors `standingResultMeansSailed` in
 * `src/lib/roll-call.ts`: `boarded` means sailed at any checkpoint, and
 * `not_boarded` means sailed only after a dive. A newer result at the same
 * subject/checkpoint supersedes the old one, including `cleared`.
 *
 * Booking and trip status are deliberately not part of the evidence: cancelling
 * either at a desk later cannot undo a result recorded on the boat (#1836).
 */
export function tripHasStandingSailedRollCall(db: DbExecutor) {
  const diver = alias(rollCallEvents, "sailed_diver_event");
  const newerDiver = alias(rollCallEvents, "newer_sailed_diver_event");
  const crew = alias(rollCallEvents, "sailed_crew_event");
  const newerCrew = alias(rollCallEvents, "newer_sailed_crew_event");

  const diverHasNewerAtCheckpoint = db
    .select({ one: sql`1` })
    .from(newerDiver)
    .where(
      and(
        seatMarks(newerDiver),
        eq(newerDiver.shopId, diver.shopId),
        eq(newerDiver.tripId, diver.tripId),
        eq(newerDiver.bookingId, diver.bookingId),
        eq(newerDiver.checkpoint, diver.checkpoint),
        isNewerMark(newerDiver, diver),
      ),
    );
  const diverEvidence = db
    .select({ one: sql`1` })
    .from(diver)
    .where(
      and(
        seatMarks(diver),
        eq(diver.shopId, trips.shopId),
        eq(diver.tripId, trips.id),
        or(
          eq(diver.status, "boarded"),
          and(eq(diver.status, "not_boarded"), ne(diver.checkpoint, "departure")),
        ),
        notExists(diverHasNewerAtCheckpoint),
      ),
    );

  const crewHasNewerAtCheckpoint = db
    .select({ one: sql`1` })
    .from(newerCrew)
    .where(
      and(
        crewMarks(newerCrew),
        eq(newerCrew.shopId, crew.shopId),
        eq(newerCrew.tripId, crew.tripId),
        eq(newerCrew.crewPersonId, crew.crewPersonId),
        eq(newerCrew.checkpoint, crew.checkpoint),
        isNewerMark(newerCrew, crew),
      ),
    );
  const crewEvidence = db
    .select({ one: sql`1` })
    .from(crew)
    .where(
      and(
        crewMarks(crew),
        eq(crew.shopId, trips.shopId),
        eq(crew.tripId, trips.id),
        or(
          eq(crew.status, "boarded"),
          and(eq(crew.status, "not_boarded"), ne(crew.checkpoint, "departure")),
        ),
        notExists(crewHasNewerAtCheckpoint),
      ),
    );

  return or(exists(diverEvidence), exists(crewEvidence));
}
