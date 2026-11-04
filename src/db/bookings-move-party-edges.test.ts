import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { createBooking, moveParty } from "./bookings";
import type { AppDb } from "./client";
import { createTrip, upcomingTripsWithCounts } from "./trips";

/**
 * The edges of `moveParty` (#2556) the family tests do not reach: a lead that
 * is nowhere, and a failure that is not a refusal, which must surface rather
 * than be read as one.
 */

const ctx = fileScopedShopContext();
const DAY_MS = 24 * 60 * 60 * 1000;

async function twoBoats() {
  const { db, shop } = ctx;
  const from = (await upcomingTripsWithCounts(db, shop.id))[0];
  if (!from) throw new Error("seeded trip missing");
  const to = await createTrip(db, {
    shopId: shop.id,
    title: "Edge target",
    startsAt: new Date(from.startsAt.getTime() + 40 * DAY_MS),
    endsAt: new Date(from.startsAt.getTime() + 40 * DAY_MS + 4 * 60 * 60 * 1000),
    capacity: 6,
    plannedDives: 2,
    priceCents: 12_000,
  });
  if (!to) throw new Error("target trip failed");
  return { db, shop, from, to };
}

describe("moveParty edges", () => {
  it("says not_found for a lead id that names no seat on the departure", async () => {
    const { db, shop, from, to } = await twoBoats();
    expect(
      await moveParty(db, {
        shopId: shop.id,
        fromTripId: from.id,
        toTripId: to.id,
        leadBookingId: "00000000-0000-4000-8000-000000000000",
      }),
    ).toMatchObject({ ok: false, outcome: { reason: "not_found" } });
  });

  it("says not_found for a seat on another departure than the one named", async () => {
    const { db, shop, from, to } = await twoBoats();
    const booked = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: to.id,
      fullName: "Edge Elsewhere",
      email: "edge-elsewhere@example.com",
    });
    if (!booked.ok) throw new Error(booked.reason);
    expect(
      await moveParty(db, {
        shopId: shop.id,
        fromTripId: from.id,
        toTripId: to.id,
        leadBookingId: booked.bookingId,
      }),
    ).toMatchObject({ ok: false, outcome: { reason: "not_found" } });
  });

  it("lets a failure that is not a refusal surface instead of reading it as one", async () => {
    const { db, shop, from, to } = await twoBoats();
    const broken = new Proxy(db, {
      get(target, key, receiver) {
        if (key === "transaction") return () => Promise.reject(new Error("connection lost"));
        return Reflect.get(target, key, receiver);
      },
    }) as AppDb;
    await expect(
      moveParty(broken, {
        shopId: shop.id,
        fromTripId: from.id,
        toTripId: to.id,
        leadBookingId: "00000000-0000-4000-8000-000000000000",
      }),
    ).rejects.toThrow("connection lost");
  });
});
