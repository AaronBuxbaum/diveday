// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail, fakeSms } from "@/test/fakes";
import { createBooking } from "./bookings";
import type { AppDb } from "./client";
import {
  listOpenLostItems,
  listTripLostItems,
  lostItemDescriptionProblem,
  recordLostItem,
  setLostItemStatus,
  tellLostItemOwner,
} from "./lost-items";
import { lostItems, shops } from "./schema";
import { createTrip } from "./trips";

/**
 * **Lost and found** (batch 4, J2). The one tap messages a diver, so whose
 * item it is may only come from a seat on that departure of that shop, and a
 * second tap never messages them again.
 */
const ctx = fileScopedShopContext();
const HOUR = 3_600_000;

async function departure(db: AppDb, shopId: string) {
  const startsAt = new Date(nowDate().getTime() - 6 * HOUR);
  const trip = await createTrip(db, {
    shopId,
    title: "Lost and found test",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * HOUR),
    capacity: 8,
  });
  if (!trip) throw new Error("trip not created");
  return trip;
}

async function upcoming(db: AppDb, shopId: string) {
  const startsAt = new Date(nowDate().getTime() + 6 * HOUR);
  const trip = await createTrip(db, {
    shopId,
    title: "Seat source",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * HOUR),
    capacity: 8,
  });
  if (!trip) throw new Error("trip not created");
  return trip;
}

let seq = 0;
async function seat(
  db: AppDb,
  shopId: string,
  tripId: string,
  contact: { email?: string; phone?: string },
) {
  seq += 1;
  const outcome = await createBooking(db, {
    actor: "staff",
    shopId,
    tripId,
    fullName: `Owner ${seq}`,
    email: contact.email,
    phone: contact.phone,
  });
  if (!outcome.ok) throw new Error(`seat refused: ${outcome.reason}`);
  return outcome;
}

/** A departure with one seat on it (booked while it still takes seats). */
async function sailedWithSeat(
  db: AppDb,
  shopId: string,
  contact: { email?: string; phone?: string },
) {
  const trip = await upcoming(db, shopId);
  const booked = await seat(db, shopId, trip.id, contact);
  return { trip, booked };
}

async function otherShop(db: AppDb) {
  seq += 1;
  const [row] = await db
    .insert(shops)
    .values({
      name: "Coral Ledge Divers",
      slug: `coral-ledge-lost-${seq}`,
      timezone: "America/New_York",
    })
    .returning({ id: shops.id });
  if (!row) throw new Error("second shop not inserted");
  return row;
}

describe("lostItemDescriptionProblem", () => {
  it("refuses empty, long and linked descriptions", () => {
    expect(lostItemDescriptionProblem("  ")).toBe("empty");
    expect(lostItemDescriptionProblem("a".repeat(121))).toBe("too_long");
    expect(lostItemDescriptionProblem("claim at lost.example")).toBe("link");
    expect(lostItemDescriptionProblem("Blue mask, seat 4")).toBeNull();
  });
});

describe("recordLostItem", () => {
  it("records an unclaimed item on a departure", async () => {
    const { db, shop } = ctx;
    const trip = await departure(db, shop.id);
    const result = await recordLostItem(db, {
      shopId: shop.id,
      tripId: trip.id,
      description: "  Blue   mask ",
      actorPersonId: null,
    });
    if (!result.ok) throw new Error(result.reason);
    expect(result.item).toMatchObject({ description: "Blue mask", status: "open", personId: null });
    expect(await listTripLostItems(db, shop.id, trip.id)).toHaveLength(1);
    expect((await listOpenLostItems(db, shop.id)).map((i) => i.id)).toContain(result.item.id);
  });

  it("ties an item to the seat's diver", async () => {
    const { db, shop } = ctx;
    const { trip, booked } = await sailedWithSeat(db, shop.id, { email: "owner-a@example.com" });
    const result = await recordLostItem(db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: booked.bookingId,
      description: "Fins",
      actorPersonId: null,
    });
    if (!result.ok) throw new Error(result.reason);
    expect(result.item.personId).toBe(booked.personId);
  });

  it("refuses a seat from another departure", async () => {
    const { db, shop } = ctx;
    const { booked } = await sailedWithSeat(db, shop.id, { email: "owner-b@example.com" });
    const elsewhere = await departure(db, shop.id);
    expect(
      await recordLostItem(db, {
        shopId: shop.id,
        tripId: elsewhere.id,
        bookingId: booked.bookingId,
        description: "Fins",
        actorPersonId: null,
      }),
    ).toEqual({ ok: false, reason: "seat_not_on_trip" });
  });

  it("cannot record on another shop's departure", async () => {
    const { db, shop } = ctx;
    const trip = await departure(db, shop.id);
    const other = await otherShop(db);
    expect(
      await recordLostItem(db, {
        shopId: other.id,
        tripId: trip.id,
        description: "Fins",
        actorPersonId: null,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("setLostItemStatus", () => {
  it("resolves, reopens, and is scoped to the shop", async () => {
    const { db, shop } = ctx;
    const trip = await departure(db, shop.id);
    const result = await recordLostItem(db, {
      shopId: shop.id,
      tripId: trip.id,
      description: "Hoodie",
      actorPersonId: null,
    });
    if (!result.ok) throw new Error(result.reason);
    const other = await otherShop(db);
    expect(
      await setLostItemStatus(db, {
        shopId: other.id,
        itemId: result.item.id,
        status: "discarded",
        actorPersonId: null,
      }),
    ).toBe(false);

    expect(
      await setLostItemStatus(db, {
        shopId: shop.id,
        itemId: result.item.id,
        status: "returned",
        actorPersonId: null,
      }),
    ).toBe(true);
    const [returned] = await db.select().from(lostItems).where(eq(lostItems.id, result.item.id));
    expect(returned?.status).toBe("returned");
    expect(returned?.resolvedAt).not.toBeNull();
    expect((await listOpenLostItems(db, shop.id)).map((i) => i.id)).not.toContain(result.item.id);

    await setLostItemStatus(db, {
      shopId: shop.id,
      itemId: result.item.id,
      status: "open",
      actorPersonId: null,
    });
    const [reopened] = await db.select().from(lostItems).where(eq(lostItems.id, result.item.id));
    expect(reopened).toMatchObject({ status: "open", resolvedAt: null });
  });
});

describe("tellLostItemOwner", () => {
  it("emails the owner once, and refuses a second tap", async () => {
    const { db, shop } = ctx;
    const { trip, booked } = await sailedWithSeat(db, shop.id, { email: "owner-c@example.com" });
    const result = await recordLostItem(db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: booked.bookingId,
      description: "Blue mask",
      actorPersonId: null,
    });
    if (!result.ok) throw new Error(result.reason);
    const email = fakeEmail();

    expect(
      await tellLostItemOwner(
        db,
        { shopId: shop.id, itemId: result.item.id },
        { emailProvider: email.provider },
      ),
    ).toEqual({ ok: true, channel: "email" });
    expect(email.sent).toEqual([
      expect.objectContaining({
        kind: "lost_item_found",
        to: "owner-c@example.com",
        description: "Blue mask",
      }),
    ]);
    expect(
      await tellLostItemOwner(
        db,
        { shopId: shop.id, itemId: result.item.id },
        { emailProvider: email.provider },
      ),
    ).toEqual({ ok: false, reason: "already_told" });
    expect(email.sent).toHaveLength(1);
  });

  it("texts an owner with no email", async () => {
    const { db, shop } = ctx;
    const { trip, booked } = await sailedWithSeat(db, shop.id, { phone: "+13055550123" });
    const result = await recordLostItem(db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: booked.bookingId,
      description: "Weight belt",
      actorPersonId: null,
    });
    if (!result.ok) throw new Error(result.reason);
    const sms = fakeSms();
    expect(
      await tellLostItemOwner(
        db,
        { shopId: shop.id, itemId: result.item.id },
        { smsProvider: sms.provider, whatsAppProviders: new Map() },
      ),
    ).toEqual({ ok: true, channel: "sms" });
    expect(sms.sent[0]?.body).toContain("Weight belt");
  });

  it("refuses an unclaimed item, a resolved item, and another shop", async () => {
    const { db, shop } = ctx;
    const trip = await departure(db, shop.id);
    const loose = await recordLostItem(db, {
      shopId: shop.id,
      tripId: trip.id,
      description: "Snorkel",
      actorPersonId: null,
    });
    if (!loose.ok) throw new Error(loose.reason);
    const email = fakeEmail();
    expect(
      await tellLostItemOwner(
        db,
        { shopId: shop.id, itemId: loose.item.id },
        { emailProvider: email.provider },
      ),
    ).toEqual({ ok: false, reason: "no_owner" });

    const { trip: seated, booked } = await sailedWithSeat(db, shop.id, {
      email: "owner-d@example.com",
    });
    const owned = await recordLostItem(db, {
      shopId: shop.id,
      tripId: seated.id,
      bookingId: booked.bookingId,
      description: "Torch",
      actorPersonId: null,
    });
    if (!owned.ok) throw new Error(owned.reason);
    const other = await otherShop(db);
    expect(
      await tellLostItemOwner(
        db,
        { shopId: other.id, itemId: owned.item.id },
        { emailProvider: email.provider },
      ),
    ).toEqual({ ok: false, reason: "not_found" });

    await setLostItemStatus(db, {
      shopId: shop.id,
      itemId: owned.item.id,
      status: "discarded",
      actorPersonId: null,
    });
    expect(
      await tellLostItemOwner(
        db,
        { shopId: shop.id, itemId: owned.item.id },
        { emailProvider: email.provider },
      ),
    ).toEqual({ ok: false, reason: "not_open" });
    expect(email.sent).toEqual([]);
  });
});
