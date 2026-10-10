import { randomBytes } from "node:crypto";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { createBooking } from "./bookings";
import type { AppDb } from "./client";
import { createGearItem, reserveGearUnit } from "./gear";
import { createCounterRental } from "./gear-counter-rentals";
import { certifications, gearReservations, people, personRoles, shops, trips } from "./schema";

/** A setup reservation: a hand pick whose staffer already said "Assign anyway". */
const SETUP_PICK = { proposed: false, assignAnyway: true } as const;

/**
 * The counter-rental writer under genuine contention — the sibling of
 * `gear-reservations.postgres.test.ts`, with the same starting gate: a
 * `FOR UPDATE` on the unit's row that every contender's INSERT parks behind
 * (its foreign-key check wants `KEY SHARE`), so the race is a fact of the run.
 *
 * What it proves is the ADR's one rule for double booking, now that two
 * writers and two holder shapes reach the same wall: the
 * `gear_reservations_no_overlap` exclusion constraint hands a unit to exactly
 * one of them, and the loser gets the worded refusal naming the unit, never a
 * deadlock and never a second "ok".
 */

const HOUR_MS = 60 * 60 * 1000;
const FROM = "2099-09-01";
const UNTIL = "2099-09-02";
const TODAY = "2099-08-31";

async function counterShop(db: AppDb, people_: number) {
  const suffix = randomBytes(4).toString("hex");
  const [shop] = await db
    .insert(shops)
    .values({
      name: `Counter Race Divers ${suffix}`,
      slug: `counter-race-${suffix}`,
      timezone: "America/New_York",
    })
    .returning();
  if (!shop) throw new Error("shop insert returned no row");
  const item = await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #1" });
  if (!item.ok) throw new Error(`gear item refused: ${item.reason}`);
  const personIds: string[] = [];
  for (let i = 0; i < people_; i++) {
    const [row] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: `Walk-in ${i + 1}` })
      .returning();
    if (!row) throw new Error("person insert returned no row");
    await db.insert(personRoles).values({ personId: row.id, role: "diver" });
    // A BCD is life support: each walk-in carries a verified card, so the race
    // is about the unit and never about the card rule.
    await db.insert(certifications).values({
      shopId: shop.id,
      personId: row.id,
      agency: "padi",
      level: "open_water",
      identifier: `OW-${suffix}-${i}`,
      status: "verified",
    });
    personIds.push(row.id);
  }
  return { shopId: shop.id, gearItemId: item.item.id, personIds };
}

const unitRowLock = (gearItemId: string) =>
  sql`select id from gear_items where id = ${gearItemId} for update`;

async function openReservations(db: AppDb, gearItemId: string): Promise<number> {
  const [row] = await db
    .select({ held: count(gearReservations.id) })
    .from(gearReservations)
    .where(
      and(
        eq(gearReservations.gearItemId, gearItemId),
        isNull(gearReservations.returnedAt),
        isNull(gearReservations.releasedAt),
      ),
    );
  return row?.held ?? 0;
}

describePostgres("createCounterRental under real concurrency", () => {
  it("lends the unit to exactly one of two counters renting it at the same instant", async () => {
    const pg = await postgresTestDb();
    const { shopId, gearItemId, personIds } = await counterShop(pg.db, 2);

    const gate = await holdRowLock(pg, unitRowLock(gearItemId));
    const contenders = personIds.map((personId) =>
      createCounterRental(pg.connect(), {
        shopId,
        personId,
        gearItemIds: [gearItemId],
        reservedFrom: FROM,
        reservedUntil: UNTIL,
        todayLocal: TODAY,
      }),
    );
    await waitForLockWaiters(pg.db, contenders.length);
    await gate.release();

    const outcomes = await Promise.all(contenders);
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.ok)).toEqual([
      { ok: false, reason: "unit_unavailable", unitId: gearItemId },
    ]);
    expect(await openReservations(pg.db, gearItemId)).toBe(1);
  });

  it("arbitrates a counter rental racing a trip assignment for the same unit", async () => {
    const pg = await postgresTestDb();
    const { shopId, gearItemId, personIds } = await counterShop(pg.db, 1);
    const startsAt = new Date(nowDate().getTime() + 24 * HOUR_MS);
    const [trip] = await pg.db
      .insert(trips)
      .values({
        shopId,
        title: "Two-Tank Reef",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
        capacity: 6,
      })
      .returning();
    if (!trip) throw new Error("trip insert returned no row");
    const booking = await createBooking(pg.db, {
      actor: "staff",
      shopId,
      tripId: trip.id,
      fullName: "Boat Diver",
      email: `boat-${randomBytes(4).toString("hex")}@example.com`,
    });
    if (!booking.ok) throw new Error(`booking refused: ${booking.reason}`);
    const [personId] = personIds;
    if (!personId) throw new Error("one person expected");

    const gate = await holdRowLock(pg, unitRowLock(gearItemId));
    const counter = createCounterRental(pg.connect(), {
      shopId,
      personId,
      gearItemIds: [gearItemId],
      reservedFrom: FROM,
      reservedUntil: UNTIL,
      todayLocal: TODAY,
    });
    const boat = reserveGearUnit(pg.connect(), {
      shopId,
      gearItemId,
      bookingId: booking.bookingId,
      reservedFrom: UNTIL,
      reservedUntil: UNTIL,
      screen: SETUP_PICK,
    });
    await waitForLockWaiters(pg.db, 2);
    await gate.release();

    const [counterOutcome, boatOutcome] = await Promise.all([counter, boat]);
    // Exactly one winner, whichever it was.
    expect([counterOutcome.ok, boatOutcome.ok].filter(Boolean)).toHaveLength(1);
    expect(await openReservations(pg.db, gearItemId)).toBe(1);
  });
});
