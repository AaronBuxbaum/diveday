import { and, count, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";
import { liveTrip, seatNotCancelled } from "@/db/trips";
import type { AppDb } from "../../db/client";
import { bookings, rollCallEventClaims, trips } from "../../db/schema/index";

import {
  type DiveIntent,
  type DiveIntentCount,
  orderedDiveIntentCounts,
} from "../../lib/dive-intent";

/**
 * **What the divers aboard came for, as counts** (ADR
 * 20260904-reef-all-the-way-down, D12/#1172 with D23/#1183 folded in).
 *
 * Codes and numbers, never a sentence and never a name: D23's boundary is
 * "aggregate conversation starters, never individual preferences", so nothing
 * here can return who said what. The words are the surface's
 * (`src/features/dive-intent/labels.ts`).
 *
 * `bookings` carries its own `shop_id` (CR-007), so the tenant filter is
 * direct; the join to `trips` is there for `liveTrip()` alone, so a departure
 * a shop took off the board cannot go on speaking through its old seats.
 *
 * The grouping happens in SQL and the ordered projection is shared with the
 * pure tally, so they cannot drift about which answer reads first.
 */
export async function diveIntentTallyForTrip(
  db: AppDb,
  shopId: string,
  tripId: string,
): Promise<DiveIntentCount[]> {
  const tallies = await diveIntentTallyForTrips(db, shopId, [tripId]);
  return tallies.get(tripId) ?? [];
}

/**
 * The same tally for a whole day's departures, in one query rather than one
 * per station. Departures nobody answered on are absent from the map, which is
 * what lets a caller render nothing for them without checking a length.
 */
export async function diveIntentTallyForTrips(
  db: AppDb,
  shopId: string,
  tripIds: readonly string[],
): Promise<Map<string, DiveIntentCount[]>> {
  if (tripIds.length === 0) return new Map();
  const rows = await intentTallyRows(db, shopId, tripIds);
  return projectTallyRows(rows);
}

function intentTallyRows(db: AppDb, shopId: string, tripIds: readonly string[]) {
  return db
    .select({
      tripId: bookings.tripId,
      intent: bookings.diveIntent,
      seats: count(bookings.id).as("seats"),
      kind: sql<string>`'intent'`.as("kind"),
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        liveTrip(),
        eq(bookings.shopId, shopId),
        inArray(bookings.tripId, [...tripIds]),
        seatNotCancelled,
        isNotNull(bookings.diveIntent),
      ),
    )
    .groupBy(bookings.tripId, bookings.diveIntent);
}

/** One statement for card intent counts and retained warnings, even with no seats. */
export async function diveIntentTallyAndRetainedSafetyForTrips(
  db: AppDb,
  shopId: string,
  tripIds: readonly string[],
) {
  if (tripIds.length === 0)
    return {
      diveIntents: new Map<string, DiveIntentCount[]>(),
      retainedSafetyTripIds: new Set<string>(),
    };
  const rows = await unionAll(
    intentTallyRows(db, shopId, tripIds),
    db
      .selectDistinct({
        tripId: rollCallEventClaims.tripId,
        intent: sql<DiveIntent | null>`null::dive_intent`.as("intent"),
        seats: sql<number>`0::integer`.as("seats"),
        kind: sql<string>`'safety'`.as("kind"),
      })
      .from(rollCallEventClaims)
      .where(
        and(
          eq(rollCallEventClaims.shopId, shopId),
          inArray(rollCallEventClaims.tripId, [...tripIds]),
          isNotNull(rollCallEventClaims.retainedSafetyEvidence),
        ),
      ),
  );
  return {
    diveIntents: projectTallyRows(rows.filter((row) => row.kind === "intent")),
    retainedSafetyTripIds: new Set(
      rows.filter((row) => row.kind === "safety").map((row) => row.tripId),
    ),
  };
}

function projectTallyRows(
  rows: readonly { tripId: string; intent: DiveIntent | null; seats: number }[],
) {
  const byTrip = new Map<string, { intent: DiveIntent | null; seats: number }[]>();
  for (const row of rows) {
    const list = byTrip.get(row.tripId);
    if (list) list.push(row);
    else byTrip.set(row.tripId, [row]);
  }
  return new Map([...byTrip].map(([tripId, list]) => [tripId, projectCounts(list)]));
}

/**
 * SQL already counted the seats; project those grouped counts without
 * expanding them back into one entry per seat.
 */
function projectCounts(
  rows: readonly { intent: DiveIntent | null; seats: number }[],
): DiveIntentCount[] {
  const counts = new Map<DiveIntent, number>();
  for (const { intent, seats } of rows) {
    if (intent !== null) counts.set(intent, seats);
  }
  return orderedDiveIntentCounts(counts);
}
