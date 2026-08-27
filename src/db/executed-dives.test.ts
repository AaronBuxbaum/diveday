import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { deleteExecutedDive, listExecutedDives, upsertExecutedDive } from "./executed-dives";
import { people, personRoles, trips } from "./schema";

async function logFixture() {
  const { db, shop } = await seededShopContext();
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  const [trip] = await db
    .select({ id: trips.id, plannedDives: trips.plannedDives })
    .from(trips)
    .where(eq(trips.shopId, shop.id))
    .limit(1);
  if (!owner || !trip) throw new Error("executed-dive fixture needs the seeded owner and a trip");
  return { db, shop, owner, trip };
}

describe("upsertExecutedDive", () => {
  it("records a dive and reads it back on the trip", async () => {
    const { db, shop, owner, trip } = await logFixture();

    const saved = await upsertExecutedDive(db, {
      shopId: shop.id,
      tripId: trip.id,
      diveNumber: 1,
      maxDepthMeters: 18,
      recordedByPersonId: owner.id,
    });
    expect(saved).toMatchObject({ ok: true, dive: { maxDepthMeters: 18 } });

    const listed = await listExecutedDives(db, shop.id, trip.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.executed.diveNumber).toBe(1);
  });

  /**
   * Two divemasters writing the same dive number at the rail is a real
   * sequence, and this used to be a select-then-insert: the loser hit
   * `executed_dives_trip_number_live_unique` and escaped as a 500.
   */
  it("lets a second write for the same dive number land on the first one's row", async () => {
    const { db, shop, owner, trip } = await logFixture();
    const write = (maxDepthMeters: number) =>
      upsertExecutedDive(db, {
        shopId: shop.id,
        tripId: trip.id,
        diveNumber: 1,
        maxDepthMeters,
        recordedByPersonId: owner.id,
      });

    const [first, second] = await Promise.all([write(18), write(21)]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    const listed = await listExecutedDives(db, shop.id, trip.id);
    expect(listed).toHaveLength(1);
    expect([18, 21]).toContain(listed[0]?.executed.maxDepthMeters);
  });

  it("refuses a dive number the trip does not plan", async () => {
    const { db, shop, owner, trip } = await logFixture();

    expect(
      await upsertExecutedDive(db, {
        shopId: shop.id,
        tripId: trip.id,
        diveNumber: 0,
        recordedByPersonId: owner.id,
      }),
    ).toEqual({ ok: false, reason: "dive_number_out_of_range" });
    expect(
      await upsertExecutedDive(db, {
        shopId: shop.id,
        tripId: trip.id,
        diveNumber: trip.plannedDives + 1,
        recordedByPersonId: owner.id,
      }),
    ).toEqual({ ok: false, reason: "dive_number_out_of_range" });
  });

  it("refuses a transposed entry and exit time rather than storing it", async () => {
    const { db, shop, owner, trip } = await logFixture();

    expect(
      await upsertExecutedDive(db, {
        shopId: shop.id,
        tripId: trip.id,
        diveNumber: 1,
        enteredAt: new Date("2026-07-21T15:00:00.000Z"),
        exitedAt: new Date("2026-07-21T14:00:00.000Z"),
        recordedByPersonId: owner.id,
      }),
    ).toEqual({ ok: false, reason: "times_transposed" });
    expect(await listExecutedDives(db, shop.id, trip.id)).toHaveLength(0);
  });

  it("refuses a negative depth", async () => {
    const { db, shop, owner, trip } = await logFixture();

    expect(
      await upsertExecutedDive(db, {
        shopId: shop.id,
        tripId: trip.id,
        diveNumber: 1,
        maxDepthMeters: -5,
        recordedByPersonId: owner.id,
      }),
    ).toEqual({ ok: false, reason: "depth_out_of_range" });
  });

  /** A shop may only write the log of its own departure. */
  it("refuses another shop's trip", async () => {
    const { db, shop, owner, trip } = await logFixture();

    expect(
      await upsertExecutedDive(db, {
        shopId: crypto.randomUUID(),
        tripId: trip.id,
        diveNumber: 1,
        recordedByPersonId: owner.id,
      }),
    ).toEqual({ ok: false, reason: "unknown_trip" });
    expect(await listExecutedDives(db, shop.id, trip.id)).toHaveLength(0);
  });

  it("refuses a recorder who is not on this shop's roster", async () => {
    const { db, shop, trip } = await logFixture();

    expect(
      await upsertExecutedDive(db, {
        shopId: shop.id,
        tripId: trip.id,
        diveNumber: 1,
        recordedByPersonId: crypto.randomUUID(),
      }),
    ).toEqual({ ok: false, reason: "unknown_recorder" });
  });

  it("keeps only the two observed-condition fields it understands", async () => {
    const { db, shop, owner, trip } = await logFixture();

    const saved = await upsertExecutedDive(db, {
      shopId: shop.id,
      tripId: trip.id,
      diveNumber: 1,
      observedConditions: { visibility: "20m", current: "mild", surprise: "dropped" },
      recordedByPersonId: owner.id,
    });

    expect(saved).toMatchObject({
      ok: true,
      dive: { observedConditions: { visibility: "20m", current: "mild" } },
    });
  });
});

describe("deleteExecutedDive", () => {
  it("takes a dive off the log and frees its number for a fresh entry", async () => {
    const { db, shop, owner, trip } = await logFixture();
    const saved = await upsertExecutedDive(db, {
      shopId: shop.id,
      tripId: trip.id,
      diveNumber: 1,
      maxDepthMeters: 18,
      recordedByPersonId: owner.id,
    });
    if (!saved.ok) throw new Error("fixture write failed");

    expect(
      await deleteExecutedDive(db, {
        shopId: shop.id,
        tripId: trip.id,
        diveNumber: 1,
        deletedByPersonId: owner.id,
      }),
    ).toBe(true);
    expect(await listExecutedDives(db, shop.id, trip.id)).toHaveLength(0);

    // The unique index covers live rows only, so the number is available again.
    const again = await upsertExecutedDive(db, {
      shopId: shop.id,
      tripId: trip.id,
      diveNumber: 1,
      maxDepthMeters: 21,
      recordedByPersonId: owner.id,
    });
    expect(again).toMatchObject({ ok: true, dive: { maxDepthMeters: 21 } });
  });
});
