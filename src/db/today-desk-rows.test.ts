import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { groupByDeparture } from "@/lib/today";
import { fileScopedShopContext } from "@/test/db";
import { createBoat } from "./boats";
import { countOpenLostItems, openLostItemsByPerson, recordLostItem } from "./lost-items";
import { lostItems, shops } from "./schema";
import { getTodayWork } from "./today";
import { createTrip, getTripRoster, upcomingTripsWithCounts } from "./trips";

/** One database for the file, one rolled-back transaction per test. */
const ctx = fileScopedShopContext();

const BLANK = { lines: [], vessel: "", shoreContact: "", plan: "" };

describe("the blank emergency card row (fifth loop, item 3)", () => {
  it("is absent while the card carries a number", async () => {
    const { db, shop } = ctx;
    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone, nowDate());
    expect(work.actions.some((row) => row.kind === "emergency_card_blank")).toBe(false);
  });

  it("names the first boat inside 48 hours that would sail with a blank card", async () => {
    const { db, shop } = ctx;
    await db.update(shops).set({ emergencyReference: BLANK }).where(eq(shops.id, shop.id));
    const now = nowDate();
    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone, now);
    const row = work.actions.find((action) => action.kind === "emergency_card_blank");
    expect(row?.subject).toBe("Your emergency reference has no numbers");
    expect(row?.detail).toMatch(/sails without a chamber or coastguard number on it\.$/);
    expect(row?.href).toBe(`/shop/${shop.slug}/settings/emergency-reference`);
    // Filed under the boat it names, so it sits in that boat's group with the
    // boat's own rows rather than below every boat in the desk's.
    expect(row?.departure?.tripId).toBeDefined();
    const group = groupByDeparture(work.actions).find((candidate) =>
      candidate.rows.some((action) => action.kind === "emergency_card_blank"),
    );
    expect(group?.departure?.tripId).toBe(row?.departure?.tripId);
    expect(row?.dueAt?.getTime()).toBeGreaterThan(now.getTime() - 60 * 60 * 1000);
    expect((row?.dueAt?.getTime() ?? 0) - now.getTime()).toBeLessThanOrEqual(48 * 60 * 60 * 1000);
  });

  // Issue #2788: two boats at one minute with the same title hung the row on
  // whichever trip id sorted first, which is fresh every seed. The boat's name
  // decides, so the card names the same hull each run.
  it("files the card under the boat that reads first when two sail at the same minute", async () => {
    const { db, shop } = ctx;
    await db.update(shops).set({ emergencyReference: BLANK }).where(eq(shops.id, shop.id));
    const now = nowDate();
    const startsAt = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    startsAt.setSeconds(0, 0);
    const make = async (boatName: string) => {
      const boat = await createBoat(db, shop.id, boatName, 12);
      const trip = await createTrip(db, {
        shopId: shop.id,
        title: "Twin charter",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 2 * 60 * 60 * 1000),
        capacity: 6,
        boatId: boat.id,
      });
      if (!trip) throw new Error("trip not created");
      return trip;
    };
    // Created Bravo first, so a creation-order or id tiebreak would pick it.
    const bravo = await make("Bravo");
    const alpha = await make("Alpha");
    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone, now);
    const row = work.actions.find((action) => action.kind === "emergency_card_blank");
    expect(row?.departure?.tripId).toBe(alpha.id);
    expect(row?.departure?.tripId).not.toBe(bravo.id);
  });

  it("counts a shore contact or a plan with no number as blank", async () => {
    const { db, shop } = ctx;
    await db
      .update(shops)
      .set({ emergencyReference: { ...BLANK, shoreContact: "Front desk", plan: "Call for help." } })
      .where(eq(shops.id, shop.id));
    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone, nowDate());
    expect(work.actions.some((row) => row.kind === "emergency_card_blank")).toBe(true);
  });
});

describe("found items waiting to go home (fifth loop, item 7)", () => {
  it("counts the open items on one Today row, and says each owner's on their own record", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const trip = trips.find((row) => row.booked > 0);
    if (!trip) throw new Error("demo needs a booked trip");
    const [seat] = await getTripRoster(db, shop.id, trip.id);
    if (!seat) throw new Error("trip has no roster");
    expect(await countOpenLostItems(db, shop.id, nowDate())).toBe(0);

    const recorded = await recordLostItem(db, {
      shopId: shop.id,
      tripId: trip.id,
      description: "Blue mask, black strap",
      bookingId: seat.booking.id,
      actorPersonId: null,
    });
    expect(recorded.ok).toBe(true);
    await recordLostItem(db, {
      shopId: shop.id,
      tripId: trip.id,
      description: "One fin",
      actorPersonId: null,
    });

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone, nowDate());
    const row = work.actions.find((action) => action.kind === "lost_items_waiting");
    expect(row?.subject).toBe("2 things waiting to go home");
    expect(row?.href).toBe(`/shop/${shop.slug}/lost-found`);

    const byPerson = await openLostItemsByPerson(db, shop.id, [seat.person.id]);
    // The unclaimed fin is nobody's to be told about.
    expect(byPerson.get(seat.person.id)).toEqual(["Blue mask, black strap"]);
  });

  it("raises no row while Lost and found is switched off, and keeps every item", async () => {
    const { db, shop } = ctx;
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("demo needs a trip");
    await recordLostItem(db, {
      shopId: shop.id,
      tripId: trip.id,
      description: "One fin",
      actorPersonId: null,
    });
    const kinds = async () =>
      (await getTodayWork(db, shop.id, shop.slug, shop.timezone, nowDate())).actions.map(
        (action) => action.kind,
      );
    expect(await kinds()).toContain("lost_items_waiting");
    await db.update(shops).set({ lostFoundEnabled: false }).where(eq(shops.id, shop.id));
    expect(await kinds()).not.toContain("lost_items_waiting");
    expect(await countOpenLostItems(db, shop.id, nowDate())).toBe(1);
  });

  it("leaves out an unclaimed item older than thirty days, never one somebody owns", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const trip = trips.find((row) => row.booked > 0);
    if (!trip) throw new Error("demo needs a booked trip");
    const [seat] = await getTripRoster(db, shop.id, trip.id);
    if (!seat) throw new Error("trip has no roster");
    const now = nowDate();
    const longAgo = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000);
    await recordLostItem(db, {
      shopId: shop.id,
      tripId: trip.id,
      description: "Old towel",
      actorPersonId: null,
    });
    await recordLostItem(db, {
      shopId: shop.id,
      tripId: trip.id,
      description: "Old wetsuit",
      bookingId: seat.booking.id,
      actorPersonId: null,
    });
    await db.update(lostItems).set({ createdAt: longAgo }).where(eq(lostItems.shopId, shop.id));
    expect(await countOpenLostItems(db, shop.id, now)).toBe(1);
  });
});
