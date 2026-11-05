import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { expect, it } from "vitest";
import { capabilityExpiryFor } from "@/lib/booking-capabilities";
import { bookingLinkToken } from "@/lib/booking-link-token";
import { nowDate } from "@/lib/clock";
import { describePostgres, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { issueBookingCapability, mintBookingCapabilities } from "./booking-capabilities";
import { bookingCapabilities, bookings, people, shops, trips } from "./schema";

/**
 * **One live link per booking, purpose and audience, under real concurrency**
 * (issue #2711; security review of #2711, finding 9). Issuing locks the person
 * and the booking, so issues that take the lock queue behind each other; a
 * writer that does not take it meets the partial unique index, and the issue
 * resolves through `ON CONFLICT DO NOTHING` and a re-read instead of aborting
 * its send.
 */
async function seat(pg: Awaited<ReturnType<typeof postgresTestDb>>) {
  const suffix = randomBytes(4).toString("hex");
  const [shop] = await pg.db
    .insert(shops)
    .values({ name: `Live link ${suffix}`, slug: `live-link-${suffix}`, timezone: "UTC" })
    .returning();
  if (!shop) throw new Error("shop insert returned no row");
  const now = nowDate();
  const [trip] = await pg.db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Live link",
      startsAt: new Date(now.getTime() + 48 * 60 * 60 * 1000),
      endsAt: new Date(now.getTime() + 52 * 60 * 60 * 1000),
      capacity: 4,
    })
    .returning();
  if (!trip) throw new Error("trip insert returned no row");
  const [person] = await pg.db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Live Diver", email: `live-${suffix}@example.org` })
    .returning();
  if (!person) throw new Error("person insert returned no row");
  const [booking] = await pg.db
    .insert(bookings)
    .values({ shopId: shop.id, tripId: trip.id, personId: person.id, bookedAs: "diver" })
    .returning();
  if (!booking) throw new Error("booking insert returned no row");
  return { shop, trip, booking, now };
}

describePostgres("booking link issuing under concurrency", () => {
  it("two concurrent issues and a batch hand out one token from one row", async () => {
    const pg = await postgresTestDb();
    const { shop, trip, booking, now } = await seat(pg);
    const input = { shopId: shop.id, bookingId: booking.id, purpose: "readiness" as const, now };
    const [a, b, batch] = await Promise.all([
      issueBookingCapability(pg.connect(), input),
      issueBookingCapability(pg.connect(), input),
      mintBookingCapabilities(pg.connect(), {
        shopId: shop.id,
        seats: [{ bookingId: booking.id, tripEndsAt: trip.endsAt }],
        purpose: "readiness",
        now,
      }),
    ]);
    expect(a?.token).toBe(b?.token);
    expect(batch.get(booking.id)?.token).toBe(a?.token);
    const live = await pg.db
      .select({ id: bookingCapabilities.id })
      .from(bookingCapabilities)
      .where(and(eq(bookingCapabilities.bookingId, booking.id), isNull(bookingCapabilities.revokedAt)));
    expect(live).toHaveLength(1);
  });

  it("resolves an insert that races an uncommitted live row through ON CONFLICT", async () => {
    const pg = await postgresTestDb();
    const { shop, trip, booking, now } = await seat(pg);
    let release!: () => void;
    let inserted!: (id: string) => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const rowId = new Promise<string>((resolve) => (inserted = resolve));
    // A writer that skips the person lock: its row is invisible to the issue
    // below until it commits, so the issue's own insert meets the index.
    const other = pg.connect().transaction(async (tx) => {
      const [row] = await tx
        .insert(bookingCapabilities)
        .values({
          shopId: shop.id,
          bookingId: booking.id,
          purpose: "confirm",
          keyVersion: 1,
          expiresAt: capabilityExpiryFor(trip.endsAt, now),
        })
        .returning({ id: bookingCapabilities.id });
      inserted(row?.id ?? "");
      await held;
    });
    const winner = await rowId;
    const issue = issueBookingCapability(pg.connect(), {
      shopId: shop.id,
      bookingId: booking.id,
      purpose: "confirm",
      now,
    });
    // Setup only: the assertion is the outcome below.
    await waitForLockWaiters(pg.db, 1);
    release();
    await other;
    const issued = await issue;
    expect(issued?.token).toBe(bookingLinkToken({ id: winner, keyVersion: 1, purpose: "confirm" }));
  });
});
