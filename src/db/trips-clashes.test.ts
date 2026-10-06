import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { createBoat } from "./boats";
import { shops } from "./schema";
import {
  boatClashes,
  boatClashesByTrip,
  boatMoveClashes,
  createTrip,
  deleteTrip,
  moveTrip,
  setTripStatus,
} from "./trips";

const ctx = fileScopedShopContext();
const FOREIGN_SHOP_ID = "00000000-0000-4000-8000-000000000099";
/** UTC-10, no DST: a shop day runs 10:00Z to 10:00Z. */
const TIME_ZONE = "Pacific/Honolulu";

async function departure(title: string, startsAt: string, endsAt: string, boatId: string | null) {
  const trip = await createTrip(ctx.db, {
    shopId: ctx.shop.id,
    title,
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
    capacity: 6,
    boatId,
  });
  if (!trip) throw new Error(`${title} not created`);
  return trip;
}

/**
 * Two departures on one hull at 09:00–13:00 shop-local on 2030-08-03 — the
 * morning charter moved on top of the reef drift, which is H-80's own scenario
 * and the shape a shop reaches through the schedule builder.
 */
async function oneHullTwice() {
  await ctx.db.update(shops).set({ timezone: TIME_ZONE }).where(eq(shops.id, ctx.shop.id));
  const hull = await createBoat(ctx.db, ctx.shop.id, "Mantis Test Hull", 20);
  const drift = await departure(
    "The 09:00 reef drift",
    "2030-08-03T19:00:00Z",
    "2030-08-03T23:00:00Z",
    hull.id,
  );
  const charter = await departure(
    "The 07:00 charter",
    "2030-08-03T17:00:00Z",
    "2030-08-03T18:30:00Z",
    hull.id,
  );
  expect(
    (await moveTrip(ctx.db, ctx.shop.id, charter.id, new Date("2030-08-03T19:00:00Z"))).ok,
  ).toBe(true);
  return { hull, drift, charter };
}

describe("boatClashes (H-80: one hull, one departure at a time)", () => {
  it("names the other departure on the same hull, from both sides", async () => {
    const { hull, drift, charter } = await oneHullTwice();
    expect(await boatClashes(ctx.db, ctx.shop.id, charter.id)).toEqual([
      { otherTripId: drift.id, otherTitle: "The 09:00 reef drift", boatName: hull.name },
    ]);
    expect(await boatClashes(ctx.db, ctx.shop.id, drift.id)).toEqual([
      { otherTripId: charter.id, otherTitle: "The 07:00 charter", boatName: hull.name },
    ]);
  });

  /**
   * **Nose to tail is the plan, not a defect.** A hull that ties up at 12:00
   * and takes the 12:00 out is how a two-boat-trip day works; the predicate is
   * half-open on both ends so the two windows never touch.
   */
  it("leaves a hull handed off nose to tail alone", async () => {
    const hull = await createBoat(ctx.db, ctx.shop.id, "Nose To Tail", 20);
    const morning = await departure(
      "Morning",
      "2030-09-01T18:00:00Z",
      "2030-09-01T22:00:00Z",
      hull.id,
    );
    const afternoon = await departure(
      "Afternoon",
      "2030-09-01T22:00:00Z",
      "2030-09-02T02:00:00Z",
      hull.id,
    );
    expect(await boatClashes(ctx.db, ctx.shop.id, morning.id)).toEqual([]);
    expect(await boatClashes(ctx.db, ctx.shop.id, afternoon.id)).toEqual([]);
  });

  it("does not treat two departures with no boat as sharing one", async () => {
    const shoreA = await departure("Shore A", "2030-09-02T18:00:00Z", "2030-09-02T22:00:00Z", null);
    await departure("Shore B", "2030-09-02T18:00:00Z", "2030-09-02T22:00:00Z", null);
    expect(await boatClashes(ctx.db, ctx.shop.id, shoreA.id)).toEqual([]);
  });

  it("does not compare two different hulls", async () => {
    const one = await createBoat(ctx.db, ctx.shop.id, "Hull One", 20);
    const two = await createBoat(ctx.db, ctx.shop.id, "Hull Two", 20);
    const a = await departure("On one", "2030-09-03T18:00:00Z", "2030-09-03T22:00:00Z", one.id);
    await departure("On two", "2030-09-03T18:00:00Z", "2030-09-03T22:00:00Z", two.id);
    expect(await boatClashes(ctx.db, ctx.shop.id, a.id)).toEqual([]);
  });

  it("ignores a departure that has been called off or taken off the board", async () => {
    const { drift, charter } = await oneHullTwice();
    await setTripStatus(ctx.db, ctx.shop.id, drift.id, "cancelled");
    expect(await boatClashes(ctx.db, ctx.shop.id, charter.id)).toEqual([]);
    expect(await boatClashes(ctx.db, ctx.shop.id, drift.id)).toEqual([]);

    await setTripStatus(ctx.db, ctx.shop.id, drift.id, "scheduled");
    expect(await boatClashes(ctx.db, ctx.shop.id, charter.id)).toHaveLength(1);
    await deleteTrip(ctx.db, ctx.shop.id, drift.id);
    expect(await boatClashes(ctx.db, ctx.shop.id, charter.id)).toEqual([]);
  });

  /**
   * A hull is one object: once it has left on either departure the other is
   * not going on it, and there is nothing left to move (dive-domain-expert
   * review). Both sides go quiet at the buffered hour, never earlier.
   */
  it("goes quiet on both sides once either departure has sailed", async () => {
    const { drift, charter } = await oneHullTwice();
    // Both now leave at 19:00Z; sailed a buffered hour later.
    const beforeSailing = new Date("2030-08-03T19:59:00Z");
    const sailed = new Date("2030-08-03T20:00:00Z");
    expect(await boatClashes(ctx.db, ctx.shop.id, charter.id, beforeSailing)).toHaveLength(1);
    expect(await boatClashes(ctx.db, ctx.shop.id, drift.id, beforeSailing)).toHaveLength(1);
    expect(await boatClashes(ctx.db, ctx.shop.id, charter.id, sailed)).toEqual([]);
    expect(await boatClashes(ctx.db, ctx.shop.id, drift.id, sailed)).toEqual([]);
  });

  it("goes quiet when only the other departure has sailed", async () => {
    const hull = await createBoat(ctx.db, ctx.shop.id, "Early Leaver", 20);
    const early = await departure("Early", "2030-09-04T18:00:00Z", "2030-09-04T23:00:00Z", hull.id);
    const late = await departure("Late", "2030-09-04T21:00:00Z", "2030-09-05T01:00:00Z", hull.id);
    const earlyGone = new Date("2030-09-04T19:30:00Z");
    expect(await boatClashes(ctx.db, ctx.shop.id, late.id, earlyGone)).toEqual([]);
    expect(await boatClashes(ctx.db, ctx.shop.id, early.id, earlyGone)).toEqual([]);
    expect(
      await boatClashes(ctx.db, ctx.shop.id, late.id, new Date("2030-09-04T18:30:00Z")),
    ).toHaveLength(1);
  });

  it("answers for several departures in one read, and never for another shop", async () => {
    const { drift, charter } = await oneHullTwice();
    const quiet = await departure("Alone", "2030-09-04T18:00:00Z", "2030-09-04T22:00:00Z", null);
    const byTrip = await boatClashesByTrip(ctx.db, ctx.shop.id, [drift.id, charter.id, quiet.id]);
    expect(byTrip.get(drift.id)?.map((row) => row.otherTripId)).toEqual([charter.id]);
    expect(byTrip.get(charter.id)?.map((row) => row.otherTripId)).toEqual([drift.id]);
    expect(byTrip.has(quiet.id)).toBe(false);

    expect(await boatClashes(ctx.db, FOREIGN_SHOP_ID, charter.id)).toEqual([]);
    expect((await boatClashesByTrip(ctx.db, ctx.shop.id, [])).size).toBe(0);
  });
});

describe("boatMoveClashes", () => {
  it("names the departure the move would land the hull on, and only for those hours", async () => {
    await ctx.db.update(shops).set({ timezone: TIME_ZONE }).where(eq(shops.id, ctx.shop.id));
    const hull = await createBoat(ctx.db, ctx.shop.id, "Mover Hull", 20);
    const moving = await departure(
      "The one being moved",
      "2030-08-01T18:00:00Z",
      "2030-08-01T22:00:00Z",
      hull.id,
    );
    const other = await departure(
      "Thursday's charter",
      "2030-08-05T18:00:00Z",
      "2030-08-05T22:00:00Z",
      hull.id,
    );

    expect(
      await boatMoveClashes(
        ctx.db,
        ctx.shop.id,
        moving.id,
        new Date("2030-08-05T20:00:00Z"),
        TIME_ZONE,
      ),
    ).toEqual([{ otherTripId: other.id, otherTitle: "Thursday's charter", boatName: hull.name }]);
    // Landing as the charter ties up: nose to tail, silent.
    expect(
      await boatMoveClashes(
        ctx.db,
        ctx.shop.id,
        moving.id,
        new Date("2030-08-05T22:00:00Z"),
        TIME_ZONE,
      ),
    ).toEqual([]);
    expect(
      await boatMoveClashes(ctx.db, ctx.shop.id, moving.id, new Date("nope"), TIME_ZONE),
    ).toEqual([]);
    expect(
      await boatMoveClashes(
        ctx.db,
        FOREIGN_SHOP_ID,
        moving.id,
        new Date("2030-08-05T20:00:00Z"),
        TIME_ZONE,
      ),
    ).toEqual([]);
  });

  it("says nothing for a departure with no boat", async () => {
    const moving = await departure("Shore", "2030-08-01T18:00:00Z", "2030-08-01T22:00:00Z", null);
    await departure("Also shore", "2030-08-05T18:00:00Z", "2030-08-05T22:00:00Z", null);
    expect(
      await boatMoveClashes(
        ctx.db,
        ctx.shop.id,
        moving.id,
        new Date("2030-08-05T18:00:00Z"),
        TIME_ZONE,
      ),
    ).toEqual([]);
  });
});
