import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { countOpenLostItems, openLostItemsByPerson, recordLostItem } from "./lost-items";
import { shops } from "./schema";
import { getTodayWork } from "./today";
import { getTripRoster, upcomingTripsWithCounts } from "./trips";

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
    expect(row?.subject).toBe("Your emergency card has no numbers");
    expect(row?.detail).toMatch(/sails without a chamber or coast guard number on it\.$/);
    expect(row?.href).toBe(`/shop/${shop.slug}/settings/emergency-reference`);
    // A shop-wide row, so it is in today's list even when the boat is tomorrow's.
    expect(row?.departure).toBeUndefined();
    expect(row?.dueAt?.getTime()).toBeGreaterThan(now.getTime() - 60 * 60 * 1000);
    expect((row?.dueAt?.getTime() ?? 0) - now.getTime()).toBeLessThanOrEqual(48 * 60 * 60 * 1000);
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
    expect(await countOpenLostItems(db, shop.id)).toBe(0);

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
});
