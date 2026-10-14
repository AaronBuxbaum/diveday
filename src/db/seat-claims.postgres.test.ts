import { randomBytes } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { createBookingParty } from "./bookings";
import type { AppDb } from "./client";
import { bookings, people, shops, trips } from "./schema";
import { claimPartySeat, issuePartySeatClaims } from "./seat-claims";

/**
 * Two people claiming one party seat at once (A§4 item 8).
 *
 * An organizer forwards a seat's claim link to a group chat and two friends
 * tap it together. `claimSeatRecord` locks the booking row and re-reads
 * `claimed_at` under it, so the second claim sees the first and is refused
 * instead of re-pointing the seat a second time. PGlite runs the two one after
 * the other; here each claim is its own backend, parked behind a gate on the
 * booking row and released together.
 *
 * Asserts the outcome, never who won (docs/engineering/testing.md, "Reading a
 * race test correctly"): exactly one claim succeeds, the seat names that
 * claimant, and the loser left no person row behind.
 */

const HOUR_MS = 60 * 60 * 1000;

async function partySeat(db: AppDb) {
  const suffix = randomBytes(4).toString("hex");
  const [shop] = await db
    .insert(shops)
    .values({ name: `Claims ${suffix}`, slug: `claims-${suffix}`, timezone: "America/New_York" })
    .returning();
  if (!shop) throw new Error("shop insert returned no row");
  const startsAt = new Date(nowDate().getTime() + 48 * HOUR_MS);
  const [trip] = await db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Two-Tank Reef",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
      capacity: 8,
    })
    .returning();
  if (!trip) throw new Error("trip insert returned no row");
  const party = await createBookingParty(db, [
    {
      actor: "public",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Orla Organizer",
      email: `orla-${suffix}@example.com`,
    },
    { actor: "public", shopId: shop.id, tripId: trip.id, fullName: "Milo Member" },
  ]);
  if (!party.ok) throw new Error(`party booking failed: ${party.reason}`);
  const [lead, member] = party.bookings;
  if (!lead || !member) throw new Error("party booking incomplete");
  const seats = await issuePartySeatClaims(db, {
    shopId: shop.id,
    leadBookingId: lead.bookingId,
  });
  const token = seats.find((seat) => seat.bookingId === member.bookingId)?.claim?.token;
  if (!token) throw new Error("expected a claim link for the member seat");
  return { bookingId: member.bookingId, token };
}

describePostgres("claimPartySeat under real concurrency", () => {
  it("gives one seat to exactly one of two people claiming it at once", async () => {
    const pg = await postgresTestDb();
    const { bookingId, token } = await partySeat(pg.db);
    const emails = ["ana@example.com", "ben@example.com"];

    const gate = await holdRowLock(
      pg,
      sql`select id from bookings where id = ${bookingId} for update`,
    );
    const claims = [
      claimPartySeat(pg.connect(), { token, fullName: "Ana Diver", email: emails[0] ?? "" }),
      claimPartySeat(pg.connect(), { token, fullName: "Ben Diver", email: emails[1] ?? "" }),
    ];
    await waitForLockWaiters(pg.db, 2);
    await gate.release();
    const outcomes = await Promise.all(claims);

    const won = outcomes.filter((outcome) => outcome.ok);
    expect(won).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.ok)).toEqual([{ ok: false, reason: "invalid" }]);
    const [seat] = await pg.db
      .select({ personId: bookings.personId, claimedAt: bookings.claimedAt })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    expect(seat?.claimedAt).not.toBeNull();
    const claimants = await pg.db
      .select({ id: people.id, email: people.email })
      .from(people)
      .where(inArray(people.email, emails));
    // The winner's row, and nobody else's: a refused claim creates no person.
    expect(claimants).toHaveLength(1);
    expect(seat?.personId).toBe(claimants[0]?.id);
  });
});
