import { randomBytes } from "node:crypto";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { createBooking } from "./bookings";
import type { AppDb } from "./client";
import { createGearItem, reserveGearUnit } from "./gear";
import { gearReservations, shops, trips } from "./schema";

/**
 * The gear double-booking guard, under genuine contention.
 *
 * `reserveGearUnit` carries no lock of its own — the whole point of the
 * `gear_reservations_no_overlap` EXCLUDE constraint is that the *database*
 * serializes two staff assigning the same unit, instead of an
 * application-level check both can read past (ADR
 * 20260815-minimal-gear-register). Every other test of that function runs on
 * PGlite, which is single-connection, so the constraint has never once been
 * contended in CI before this file — the same gap `bookings.postgres.test.ts`
 * closes for the seat-oversell `FOR UPDATE`.
 *
 * The starting gate borrows that file's trick: the contenders' INSERTs carry
 * a foreign key to `gear_items`, whose check takes a `KEY SHARE` lock on the
 * unit's row, which conflicts with the gate's `FOR UPDATE`. So both
 * contenders are provably parked inside their transactions before the gate
 * drops, and the race is a fact of the run rather than a hope. The assertion
 * that catches a broken guard is the open-reservation count: without the
 * constraint, both callers are told "ok" and the count reads 2.
 */

const HOUR_MS = 60 * 60 * 1000;

/** A shop with one unit on the register and `count` booked divers wanting it. */
async function unitWithRivals(db: AppDb, rivals: number) {
  const suffix = randomBytes(4).toString("hex");
  const [shop] = await db
    .insert(shops)
    .values({
      name: `Gear Race Divers ${suffix}`,
      slug: `gear-race-${suffix}`,
      timezone: "America/New_York",
    })
    .returning();
  if (!shop) throw new Error("shop insert returned no row");

  const startsAt = new Date(nowDate().getTime() + 24 * HOUR_MS);
  const [trip] = await db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Two-Tank Reef",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
      capacity: 12,
    })
    .returning();
  if (!trip) throw new Error("trip insert returned no row");

  const item = await createGearItem(db, {
    shopId: shop.id,
    kind: "bcd",
    label: "BCD #1",
    size: "M",
  });
  if (!item.ok) throw new Error(`gear item refused: ${item.reason}`);

  const bookingIds: string[] = [];
  for (let i = 0; i < rivals; i++) {
    const booking = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      fullName: `Diver ${i + 1}`,
      email: `diver-${i + 1}-${suffix}@example.com`,
    });
    if (!booking.ok) throw new Error(`booking refused: ${booking.reason}`);
    bookingIds.push(booking.bookingId);
  }
  return { shopId: shop.id, gearItemId: item.item.id, bookingIds };
}

/** The gate: FOR UPDATE on the unit's row, which the INSERTs' FK check parks on. */
const unitRowLock = (gearItemId: string) =>
  sql`select id from gear_items where id = ${gearItemId} for update`;

/** Open reservations actually held on a unit — what an oversold register reads as 2. */
async function openReservations(db: AppDb, gearItemId: string): Promise<number> {
  const [row] = await db
    .select({ held: count(gearReservations.id) })
    .from(gearReservations)
    .where(and(eq(gearReservations.gearItemId, gearItemId), isNull(gearReservations.returnedAt)));
  return row?.held ?? 0;
}

describePostgres("reserveGearUnit under real concurrency", () => {
  it("hands the unit to exactly one of two staff assigning it at the same instant", async () => {
    const pg = await postgresTestDb();
    const { shopId, gearItemId, bookingIds } = await unitWithRivals(pg.db, 2);

    const gate = await holdRowLock(pg, unitRowLock(gearItemId));
    const contenders = bookingIds.map((bookingId) =>
      reserveGearUnit(pg.connect(), {
        shopId,
        gearItemId,
        bookingId,
        reservedFrom: "2026-09-01",
        reservedUntil: "2026-09-02",
      }),
    );

    await waitForLockWaiters(pg.db, contenders.length);
    await gate.release();

    const outcomes = await Promise.all(contenders);
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.ok)).toEqual([
      { ok: false, reason: "unit_unavailable" },
    ]);
    // The count is what fails if the constraint ever goes away: both callers
    // would be told "ok" and the same BCD would be promised to two divers.
    expect(await openReservations(pg.db, gearItemId)).toBe(1);
  });

  it("keeps one unit to one holder across five simultaneous, partly-overlapping windows", async () => {
    const pg = await postgresTestDb();
    const { shopId, gearItemId, bookingIds } = await unitWithRivals(pg.db, 5);
    // Five different windows that all cross 2026-09-03: any two conflict, so
    // whichever contender wins, the other four must lose.
    const windows = [
      { reservedFrom: "2026-09-01", reservedUntil: "2026-09-03" },
      { reservedFrom: "2026-09-02", reservedUntil: "2026-09-04" },
      { reservedFrom: "2026-09-03", reservedUntil: "2026-09-03" },
      { reservedFrom: "2026-09-03", reservedUntil: "2026-09-05" },
      { reservedFrom: "2026-09-03", reservedUntil: "2026-09-06" },
    ];

    const gate = await holdRowLock(pg, unitRowLock(gearItemId));
    const contenders = bookingIds.map((bookingId, index) =>
      reserveGearUnit(pg.connect(), {
        shopId,
        gearItemId,
        bookingId,
        ...windows[index],
      }),
    );

    await waitForLockWaiters(pg.db, contenders.length);
    await gate.release();

    const outcomes = await Promise.all(contenders);
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => !outcome.ok && outcome.reason === "unit_unavailable"),
    ).toHaveLength(4);
    expect(await openReservations(pg.db, gearItemId)).toBe(1);
  });
});
