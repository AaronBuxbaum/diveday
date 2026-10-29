import { and, eq, exists, gt, ne, notExists, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DbExecutor } from "./client";
import { rollCallCrewEvents, rollCallEvents, trips } from "./schema";

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
  const crew = alias(rollCallCrewEvents, "sailed_crew_event");
  const newerCrew = alias(rollCallCrewEvents, "newer_sailed_crew_event");

  const diverHasNewerAtCheckpoint = db
    .select({ one: sql`1` })
    .from(newerDiver)
    .where(
      and(
        eq(newerDiver.shopId, diver.shopId),
        eq(newerDiver.tripId, diver.tripId),
        eq(newerDiver.bookingId, diver.bookingId),
        eq(newerDiver.checkpoint, diver.checkpoint),
        or(
          gt(newerDiver.occurredAt, diver.occurredAt),
          and(
            eq(newerDiver.occurredAt, diver.occurredAt),
            gt(newerDiver.createdAt, diver.createdAt),
          ),
          and(
            eq(newerDiver.occurredAt, diver.occurredAt),
            eq(newerDiver.createdAt, diver.createdAt),
            gt(newerDiver.seq, diver.seq),
          ),
        ),
      ),
    );
  const diverEvidence = db
    .select({ one: sql`1` })
    .from(diver)
    .where(
      and(
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
        eq(newerCrew.shopId, crew.shopId),
        eq(newerCrew.tripId, crew.tripId),
        eq(newerCrew.personId, crew.personId),
        eq(newerCrew.checkpoint, crew.checkpoint),
        or(
          gt(newerCrew.occurredAt, crew.occurredAt),
          and(eq(newerCrew.occurredAt, crew.occurredAt), gt(newerCrew.createdAt, crew.createdAt)),
          and(
            eq(newerCrew.occurredAt, crew.occurredAt),
            eq(newerCrew.createdAt, crew.createdAt),
            gt(newerCrew.seq, crew.seq),
          ),
        ),
      ),
    );
  const crewEvidence = db
    .select({ one: sql`1` })
    .from(crew)
    .where(
      and(
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
