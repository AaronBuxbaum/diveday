import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import type { AppDb } from "./client";
import { createDiver } from "./divers";
import { rosterFacts } from "./roster-facts";
import { orders, priorVisits, trips } from "./schema";

/**
 * The roster row's four facts (ADR 20260827-people-not-lists, decision 2).
 * The blocker half is deliberately not re-derived here — it comes out of
 * `inHorizonReadiness`, whose reduction is pinned in `src/lib/readiness.ts`
 * and whose window is pinned in `blockers`' own tests; what this file owns is
 * the departure/visit/money reading and the buffer that splits behind from
 * ahead.
 */
const NOW = new Date("2026-08-27T16:00:00Z");

async function diver(db: AppDb, shopId: string, fullName: string) {
  const person = await createDiver(db, { shopId, fullName });
  if (!person) throw new Error(`could not create ${fullName}`);
  return person;
}

async function seat(db: AppDb, shopId: string, tripId: string, personId: string) {
  const booked = await createBooking(db, { actor: "staff", shopId, tripId, personId });
  if (!booked.ok) throw new Error("could not seat the diver");
}

async function departure(db: AppDb, shopId: string, title: string, startsAt: Date) {
  const [trip] = await db
    .insert(trips)
    .values({
      shopId,
      title,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
      capacity: 6,
    })
    .returning();
  if (!trip) throw new Error("trip insert returned no row");
  return trip;
}

describe("rosterFacts", () => {
  it("reads the seat ahead, the visit behind, and nothing for a diver with neither", async () => {
    const { db, shop } = await seededShopContext();
    const ahead = await diver(db, shop.id, "Roster Ahead");
    const behind = await diver(db, shop.id, "Roster Behind");
    const nobody = await diver(db, shop.id, "Roster Nobody");

    const tomorrow = await departure(db, shop.id, "Ahead", new Date("2026-08-28T11:00:00Z"));
    const yesterday = await departure(db, shop.id, "Behind", new Date("2026-08-26T11:00:00Z"));
    await seat(db, shop.id, tomorrow.id, ahead.id);
    await seat(db, shop.id, yesterday.id, behind.id);

    const facts = await rosterFacts(db, shop.id, [ahead.id, behind.id, nobody.id], { now: NOW });
    expect(facts.get(ahead.id)).toMatchObject({
      nextBookingAt: tomorrow.startsAt,
      lastAboardAt: null,
    });
    expect(facts.get(behind.id)).toMatchObject({
      nextBookingAt: null,
      lastAboardAt: yesterday.startsAt,
    });
    expect(facts.get(nobody.id)).toMatchObject({
      nextBookingAt: null,
      lastAboardAt: null,
      importedOnly: false,
      openBalance: false,
    });
  });

  /**
   * **The late-arrival buffer, on the roster.** A boat that left an hour ago
   * is still the diver's next departure, because they may still be standing on
   * the dock (AGENTS.md's standing rule, and the split the diver record's own
   * story uses). Ten minutes past the hour it becomes the visit behind them.
   */
  it("keeps a departure that has just sailed ahead of the diver for an hour", async () => {
    const { db, shop } = await seededShopContext();
    const person = await diver(db, shop.id, "Roster Buffer");
    const trip = await departure(db, shop.id, "Buffer", new Date("2026-08-27T15:30:00Z"));
    await seat(db, shop.id, trip.id, person.id);

    const during = await rosterFacts(db, shop.id, [person.id], { now: NOW });
    expect(during.get(person.id)?.nextBookingAt).toEqual(trip.startsAt);

    const after = await rosterFacts(db, shop.id, [person.id], {
      now: new Date("2026-08-27T16:40:00Z"),
    });
    expect(after.get(person.id)?.nextBookingAt).toBeNull();
    expect(after.get(person.id)?.lastAboardAt).toEqual(trip.startsAt);
  });

  /**
   * A diver whose whole history came across from another system must not read
   * as one who has never been out (ADR 20260725-import-prior-visits) — and the
   * moment they take a seat here, they stop being that diver.
   */
  it("marks a diver whose only history was imported, until they hold a seat here", async () => {
    const { db, shop } = await seededShopContext();
    const person = await diver(db, shop.id, "Roster Imported");
    await db.insert(priorVisits).values({
      shopId: shop.id,
      personId: person.id,
      visitedOn: "2026-03-03",
      title: "Two-tank Molasses Reef",
      dedupeKey: "roster-facts-test",
      importedAt: NOW,
    });

    const before = await rosterFacts(db, shop.id, [person.id], { now: NOW });
    expect(before.get(person.id)).toMatchObject({ importedOnly: true, lastAboardAt: null });

    const trip = await departure(db, shop.id, "First real one", new Date("2026-08-26T11:00:00Z"));
    await seat(db, shop.id, trip.id, person.id);
    const after = await rosterFacts(db, shop.id, [person.id], { now: NOW });
    expect(after.get(person.id)).toMatchObject({
      importedOnly: false,
      lastAboardAt: trip.startsAt,
    });
  });

  it("raises the open-balance fact only while an invoice stands open", async () => {
    const { db, shop } = await seededShopContext();
    const person = await diver(db, shop.id, "Roster Owing");
    const [order] = await db
      .insert(orders)
      .values({
        shopId: shop.id,
        personId: person.id,
        createdByPersonId: person.id,
        status: "open",
        currency: "usd",
        totalCents: 12_000,
        stripeAccountId: "acct_test",
        stripeCustomerId: "cus_test",
        stripeInvoiceId: "in_test",
      })
      .returning();
    if (!order) throw new Error("order insert returned no row");

    expect(
      (await rosterFacts(db, shop.id, [person.id], { now: NOW })).get(person.id)?.openBalance,
    ).toBe(true);

    await db.update(orders).set({ status: "paid" }).where(eq(orders.id, order.id));
    expect(
      (await rosterFacts(db, shop.id, [person.id], { now: NOW })).get(person.id)?.openBalance,
    ).toBe(false);
  });

  it("answers with an empty map for an empty page, without touching the database", async () => {
    const { db, shop } = await seededShopContext();
    expect((await rosterFacts(db, shop.id, [], { now: NOW })).size).toBe(0);
  });

  /**
   * Tenant isolation, on a reader that takes ids from a page it did not fetch:
   * every one of the four reads is scoped by `shopId`, so another shop's
   * booking, invoice or imported visit can never surface on this roster.
   */
  it("never reads another shop's seats, invoices or imported visits", async () => {
    const { db, shop } = await seededShopContext();
    const person = await diver(db, shop.id, "Roster Isolated");
    const trip = await departure(db, shop.id, "Theirs", new Date("2026-08-26T11:00:00Z"));
    await seat(db, shop.id, trip.id, person.id);

    const elsewhere = await rosterFacts(db, "00000000-0000-0000-0000-000000000000", [person.id], {
      now: NOW,
    });
    expect(elsewhere.get(person.id)).toMatchObject({
      lastAboardAt: null,
      nextBookingAt: null,
      openBalance: false,
      importedOnly: false,
      blocker: null,
    });
  });
});
