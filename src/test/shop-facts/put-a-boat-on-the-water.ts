import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "../../db/client";
import { upsertExecutedDive } from "../../db/executed-dives";
import { recordCrewRollCall, recordRollCall } from "../../db/manifests";
import { diveSites, people, tripAssignments, tripDives, trips } from "../../db/schema/index";
import { recordLostItem } from "../../features/day/lost-items/store";
import { recordTripSighting } from "../../features/sites/trip-sightings";
import { MINUTE_MS } from "../../lib/clock";
import { seedOperationalTrust } from "./operational-trust";
import { sendADepartureOut } from "./send-a-departure-out";

const FIXTURE = {
  outstanding: "boat",
  home: "historic",
  recorded: "historic",
  unfinished: "intro",
  cancelled: "buddy",
  skipped: "intro",
} as const;

export const boatOnTheWaterArgs = z
  .object({
    state: z.enum(["outstanding", "home", "recorded", "unfinished", "cancelled", "skipped"]),
  })
  .strict();

/**
 * **A boat the crew is counting from the water** (`boatOnTheWater`): the
 * operational departure, sent out, counted aboard at the dock, then counted
 * after dive 1. `outstanding` leaves it at sea two hours in, with one diver
 * recorded not back aboard (and the crew's note) and one person with no result
 * yet; `home` brings it back five hours in, both dives counted complete and
 * logged, for Wrapped up with nothing left to close; `recorded` is `home` with
 * two species seen at dive 1's site and a mask found aboard, for What
 * happened's Seen and Left aboard rows (issue #4811); `unfinished` is home too,
 * with dive 2's count missing one person and dive 2 not logged; `skipped` is home
 * with dive 1 counted and logged and dive 2 never begun, for "Dive 2 not made"
 * (issue #4681); `cancelled` is the same departure called off before anyone was
 * counted.
 */
export async function putABoatOnTheWater(
  db: AppDb,
  shop: { id: string; timezone: string },
  { state }: z.output<typeof boatOnTheWaterArgs>,
  now: Date,
) {
  // One operational departure per state per shop: each state takes its own.
  const fixture = await seedOperationalTrust(db, shop, FIXTURE[state], now);
  const { tripId } = fixture;
  await db
    .update(trips)
    .set({
      title: "Two-Tank Reef — Molasses & French",
      ...(state === "cancelled" ? { status: "cancelled" as const, cancelledAt: now } : {}),
    })
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shop.id)));
  if (state === "cancelled") return { tripId };
  const sent = await sendADepartureOut(
    db,
    shop.id,
    { tripId, minutesAgo: state === "outstanding" ? 120 : 300 },
    now,
  );
  const startsAt = new Date(sent.startsAt);
  const at = (minutes: number) => new Date(startsAt.getTime() + minutes * MINUTE_MS);
  const crew = await db
    .select({ personId: tripAssignments.personId })
    .from(tripAssignments)
    .innerJoin(people, eq(people.id, tripAssignments.personId))
    .where(and(eq(tripAssignments.tripId, tripId), eq(people.shopId, shop.id)))
    // The fixture's captain records the count; physical assignment order
    // must not change the named actor or the crew's observation order.
    .orderBy(
      sql`case when ${tripAssignments.tripRole} = 'captain' then 0 else 1 end`,
      asc(people.fullName),
      asc(people.id),
    );
  const recorder = crew[0]?.personId;
  if (!recorder) throw new Error("boat on the water fixture has no crew");

  type Mark = { status: "boarded" | "not_boarded"; note?: string } | null;
  const count = async (
    checkpoint: "departure" | "after_dive_1" | "after_dive_2",
    minutes: number,
    mark: (index: number) => Mark,
  ) => {
    for (const [index, seat] of fixture.seats.entries()) {
      const said = mark(index);
      if (!said) continue;
      const result = await recordRollCall(db, {
        shopId: shop.id,
        tripId,
        bookingId: seat.bookingId,
        recordedByPersonId: recorder,
        checkpoint,
        status: said.status,
        note: said.note ?? null,
        occurredAt: at(minutes + index),
      });
      if (!result.ok) throw new Error(`boat on the water seat refused: ${result.reason}`);
    }
    for (const [index, { personId }] of crew.entries()) {
      const result = await recordCrewRollCall(db, {
        shopId: shop.id,
        tripId,
        personId,
        recordedByPersonId: recorder,
        checkpoint,
        status: "boarded",
        occurredAt: at(minutes + fixture.seats.length + index),
      });
      if (!result.ok) throw new Error(`boat on the water crew refused: ${result.reason}`);
    }
  };

  const aboard: Mark = { status: "boarded" };
  await count("departure", -15, () => aboard);
  if (state === "outstanding") {
    await count("after_dive_1", 82, (index) =>
      index === 0
        ? { status: "not_boarded", note: "Surfaced down-current of the mooring" }
        : index === 2
          ? null
          : aboard,
    );
  } else {
    await count("after_dive_1", 82, () => aboard);
    if (state !== "skipped") {
      await count("after_dive_2", 190, (index) =>
        state === "unfinished" && index === 1 ? null : aboard,
      );
    }
    const logs = [
      [1, 35, 14],
      [2, 130, 11],
    ] as const;
    const allLogged = state === "home" || state === "recorded";
    for (const [diveNumber, entered, depth] of allLogged ? logs : logs.slice(0, 1)) {
      const saved = await upsertExecutedDive(db, {
        shopId: shop.id,
        tripId,
        diveNumber,
        enteredAt: at(entered),
        exitedAt: at(entered + 45),
        maxDepthMeters: depth,
        recordedByPersonId: recorder,
      });
      if (!saved.ok) throw new Error(`boat on the water log refused: ${saved.reason}`);
    }
  }
  if (state === "recorded") await recordSeenAndLeftAboard(db, shop.id, tripId, recorder, at(140));
  return { tripId };
}

/**
 * Dive 1 planned at the shop's first site, two species tapped there, and one
 * item found aboard (issue #4811).
 */
async function recordSeenAndLeftAboard(
  db: AppDb,
  shopId: string,
  tripId: string,
  recorder: string,
  now: Date,
) {
  const [site] = await db
    .select({ id: diveSites.id })
    .from(diveSites)
    .where(and(eq(diveSites.shopId, shopId), isNull(diveSites.deletedAt)))
    .orderBy(asc(diveSites.name))
    .limit(1);
  if (!site) throw new Error("boat on the water fixture needs a dive site");
  await db.insert(tripDives).values({ tripId, diveNumber: 1, diveSiteId: site.id });
  for (const speciesSlug of ["green-sea-turtle", "spotted-eagle-ray"]) {
    const seen = await recordTripSighting(db, {
      shopId,
      tripId,
      diveSiteId: site.id,
      speciesSlug,
      recordedByPersonId: recorder,
      now,
    });
    if (!seen.ok) throw new Error(`boat on the water sighting refused: ${seen.reason}`);
  }
  const found = await recordLostItem(db, {
    shopId,
    tripId,
    description: "Black mask in a blue case",
    actorPersonId: recorder,
  });
  if (!found.ok) throw new Error(`boat on the water found item refused: ${found.reason}`);
}
