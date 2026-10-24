import { and, eq, gt } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { groupByDeparture } from "@/lib/today";
import { fileScopedShopContext } from "@/test/db";
import { countOpenLostItems, openLostItemsByPerson, recordLostItem } from "./lost-items";
import { lostItems, shops, trips as tripRows } from "./schema";
import { getTodayWork } from "./today";
import { getTripRoster, upcomingTripsWithCounts } from "./trips";

/** One database for the file, one rolled-back transaction per test. */
const ctx = fileScopedShopContext();

const HOUR = 60 * 60 * 1000;

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
    // The shop's card, so a desk row (Aaron 2026-10-23): no boat of its own,
    // filed under "The desk" with the units question.
    expect(row?.departure).toBeUndefined();
    const group = groupByDeparture(work.actions).find((candidate) =>
      candidate.rows.some((action) => action.kind === "emergency_card_blank"),
    );
    expect(group?.departure).toBeNull();
    expect(row?.dueAt?.getTime()).toBeGreaterThan(now.getTime() - 60 * 60 * 1000);
    expect((row?.dueAt?.getTime() ?? 0) - now.getTime()).toBeLessThanOrEqual(48 * 60 * 60 * 1000);
  });

  /**
   * **A boat at sea keeps the row** (issue #2802, Aaron's option b). The desk
   * can still radio her a number, so the row must not drop off the moment
   * she leaves; it names her, ahead of the next boat to sail.
   */
  it("keeps the row for a boat out and not back, naming her ahead of the next to sail (#2802)", async () => {
    const { db, shop } = ctx;
    await db.update(shops).set({ emergencyReference: BLANK }).where(eq(shops.id, shop.id));
    const now = nowDate();
    const startsAt = new Date(now.getTime() - 3 * HOUR);
    await db.insert(tripRows).values({
      shopId: shop.id,
      title: "Out Now — Molasses",
      startsAt,
      endsAt: new Date(now.getTime() + 2 * HOUR),
      capacity: 12,
      plannedDives: 2,
      priceCents: 13000,
    });
    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone, now);
    const rows = work.actions.filter((action) => action.kind === "emergency_card_blank");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.dueAt?.getTime()).toBe(startsAt.getTime());
    expect(rows[0]?.detail).toMatch(/is out without a chamber or coastguard number on it\.$/);
    expect(rows[0]?.urgency).toBe("imminent");
    // Still the desk's row, not filed on her card.
    expect(rows[0]?.departure).toBeUndefined();
  });

  it("raises the row for a boat out when nothing sails in the next 48 hours (#2802)", async () => {
    const { db, shop } = ctx;
    await db.update(shops).set({ emergencyReference: BLANK }).where(eq(shops.id, shop.id));
    const now = nowDate();
    // Nothing ahead: every seeded departure that has not left is moved out
    // past the window.
    await db
      .update(tripRows)
      .set({
        startsAt: new Date(now.getTime() + 30 * 24 * HOUR),
        endsAt: new Date(now.getTime() + 30 * 24 * HOUR + 4 * HOUR),
      })
      .where(
        and(eq(tripRows.shopId, shop.id), gt(tripRows.startsAt, new Date(now.getTime() - HOUR))),
      );
    const before = await getTodayWork(db, shop.id, shop.slug, shop.timezone, now);
    expect(before.actions.some((row) => row.kind === "emergency_card_blank")).toBe(false);
    await db.insert(tripRows).values({
      shopId: shop.id,
      title: "Out Now — French Reef",
      startsAt: new Date(now.getTime() - 2 * HOUR),
      endsAt: new Date(now.getTime() + HOUR),
      capacity: 12,
      plannedDives: 2,
      priceCents: 13000,
    });
    const after = await getTodayWork(db, shop.id, shop.slug, shop.timezone, now);
    expect(after.actions.some((row) => row.kind === "emergency_card_blank")).toBe(true);
  });

  it("lets the row go once the boat is back, or for a departure called off that nobody boarded (#2802)", async () => {
    const { db, shop } = ctx;
    await db.update(shops).set({ emergencyReference: BLANK }).where(eq(shops.id, shop.id));
    const now = nowDate();
    await db
      .update(tripRows)
      .set({
        startsAt: new Date(now.getTime() + 30 * 24 * HOUR),
        endsAt: new Date(now.getTime() + 30 * 24 * HOUR + 4 * HOUR),
      })
      .where(
        and(eq(tripRows.shopId, shop.id), gt(tripRows.startsAt, new Date(now.getTime() - HOUR))),
      );
    await db.insert(tripRows).values([
      {
        shopId: shop.id,
        title: "Back Already — Molasses",
        startsAt: new Date(now.getTime() - 6 * HOUR),
        endsAt: new Date(now.getTime() - 2 * HOUR),
        capacity: 12,
        plannedDives: 2,
        priceCents: 13000,
      },
      {
        shopId: shop.id,
        title: "Called Off — French Reef",
        startsAt: new Date(now.getTime() - 2 * HOUR),
        endsAt: new Date(now.getTime() + HOUR),
        capacity: 12,
        plannedDives: 2,
        priceCents: 13000,
        status: "cancelled",
      },
    ]);
    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone, now);
    expect(work.actions.some((row) => row.kind === "emergency_card_blank")).toBe(false);
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
