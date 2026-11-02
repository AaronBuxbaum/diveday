import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { describePostgres, postgresTestDb } from "@/test/postgres";
import { raceShop, withinOrParked } from "@/test/postgres-shop";
import type { AppDb } from "./client";
import { recordNotificationDelivery } from "./notifications";
import { bookings, notificationDeliveries, people, trips } from "./schema";

/**
 * Two writers racing on one booking's message (issue #2728). A once-only kind
 * is held to one row by the partial unique index, so the second writer waits
 * on the first and lands on the same row; a resendable kind takes two rows and
 * neither waits.
 */
async function bookingFixture(db: AppDb) {
  const shop = await raceShop(db, "Delivery Race");
  const now = nowDate();
  const [trip] = await db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Delivery race",
      startsAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      endsAt: new Date(now.getTime() + 28 * 60 * 60 * 1000),
      capacity: 4,
    })
    .returning();
  if (!trip) throw new Error("trip insert returned no row");
  const [person] = await db
    .insert(people)
    .values({
      shopId: shop.id,
      fullName: "Race Diver",
      email: `race-${randomBytes(4).toString("hex")}@example.org`,
    })
    .returning();
  if (!person) throw new Error("person insert returned no row");
  const [booking] = await db
    .insert(bookings)
    .values({ shopId: shop.id, tripId: trip.id, personId: person.id, bookedAs: "diver" })
    .returning();
  if (!booking) throw new Error("booking insert returned no row");
  return { shop, booking };
}

describePostgres("notification_deliveries under concurrent writers", () => {
  it("keeps a once-only kind to one row: the second writer waits, then updates it", async () => {
    const pg = await postgresTestDb();
    const { shop, booking } = await bookingFixture(pg.db);
    const other = pg.connect();

    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let firstWritten!: () => void;
    const written = new Promise<void>((resolve) => {
      firstWritten = resolve;
    });
    const first = pg.db.transaction(async (tx) => {
      await recordNotificationDelivery(tx, {
        shopId: shop.id,
        bookingId: booking.id,
        kind: "trip_reminder_24h",
        delivery: { status: "sent", providerMessageId: "first" },
      });
      firstWritten();
      await held;
    });
    await written;

    const second = recordNotificationDelivery(other, {
      shopId: shop.id,
      bookingId: booking.id,
      kind: "trip_reminder_24h",
      delivery: { status: "sent", providerMessageId: "second" },
    });
    // The index makes the loser wait on the winner's uncommitted row.
    expect(await withinOrParked(second, 500)).toBe("parked");
    release();
    await first;
    await second;

    const rows = await pg.db
      .select()
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.bookingId, booking.id),
          eq(notificationDeliveries.kind, "trip_reminder_24h"),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.providerMessageId).toBe("second");

    // A writer that skips the conflict target sees the conflict, not a second row.
    await expect(
      other.insert(notificationDeliveries).values({
        shopId: shop.id,
        bookingId: booking.id,
        kind: "trip_reminder_24h",
        status: "sent",
        providerMessageId: "third",
        attemptedAt: nowDate(),
      }),
    ).rejects.toMatchObject({ cause: expect.objectContaining({ code: "23505" }) });
  });

  it("gives a resendable kind one row per concurrent send, with neither waiting", async () => {
    const pg = await postgresTestDb();
    const { shop, booking } = await bookingFixture(pg.db);
    const other = pg.connect();

    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let firstWritten!: () => void;
    const written = new Promise<void>((resolve) => {
      firstWritten = resolve;
    });
    const first = pg.db.transaction(async (tx) => {
      await recordNotificationDelivery(tx, {
        shopId: shop.id,
        bookingId: booking.id,
        kind: "waiver_request",
        delivery: { status: "sent", providerMessageId: "first-link" },
      });
      firstWritten();
      await held;
    });
    await written;

    const second = recordNotificationDelivery(other, {
      shopId: shop.id,
      bookingId: booking.id,
      kind: "waiver_request",
      delivery: { status: "sent", providerMessageId: "second-link" },
    });
    expect(await withinOrParked(second, 3_000)).not.toBe("parked");
    release();
    await first;

    const rows = await pg.db
      .select()
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.bookingId, booking.id),
          eq(notificationDeliveries.kind, "waiver_request"),
        ),
      );
    expect(rows.map((row) => row.providerMessageId).sort()).toEqual(["first-link", "second-link"]);
  });
});
