import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Notification, NotificationProvider } from "@/lib/notifications";
import { fileScopedShopContext } from "@/test/db";
import { sendStaleRollCallAlerts } from "./roll-call-alerts";
import { bookings, people, rollCallEvents, shops, tripScheduleDays, trips } from "./schema";
import { listStaff } from "./trips";

/**
 * **The stale roll-call alert on a course that meets on two Saturdays** (#2557).
 * The run's `ends_at` is a fortnight after the first Saturday, so reading it
 * alone never alerted about the first Saturday's open count; and one claim per
 * departure would have kept the second Saturday's quiet.
 */
const ctx = fileScopedShopContext();
const ORIGIN = "https://diveday.example";
const HOUR = 60 * 60 * 1000;
// Far from every seeded departure. Saturday 2031-03-01 and 2031-03-15.
const DAY_ONE = {
  startsAt: new Date("2031-03-01T13:00:00Z"),
  endsAt: new Date("2031-03-01T17:00:00Z"),
};
const DAY_TWO = {
  startsAt: new Date("2031-03-15T13:00:00Z"),
  endsAt: new Date("2031-03-15T17:00:00Z"),
};

function recorder() {
  const sent: Notification[] = [];
  const provider: NotificationProvider = {
    async send(notification) {
      sent.push(notification);
      return { status: "sent", providerMessageId: `msg-${sent.length}` };
    },
  };
  return { sent, provider };
}

async function course() {
  const { db, shop } = ctx;
  await db.update(shops).set({ isDemo: false }).where(eq(shops.id, shop.id));
  const [trip] = await db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Open Water, two Saturdays",
      startsAt: DAY_ONE.startsAt,
      endsAt: DAY_TWO.endsAt,
      capacity: 6,
      plannedDives: 1,
    })
    .returning();
  if (!trip) throw new Error("trip insert failed");
  await db.insert(tripScheduleDays).values([
    { tripId: trip.id, dayNumber: 1, ...DAY_ONE },
    { tripId: trip.id, dayNumber: 2, ...DAY_TWO },
  ]);
  const [staff] = await listStaff(db, shop.id);
  const [person] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Ana Ruiz" })
    .returning();
  if (!staff || !person) throw new Error("fixture people missing");
  const [booking] = await db
    .insert(bookings)
    .values({ bookedAs: "diver", shopId: shop.id, tripId: trip.id, personId: person.id })
    .returning();
  if (!booking) throw new Error("booking insert failed");
  const mark = (checkpoint: string, status: "boarded" | "not_boarded", occurredAt: Date) =>
    db.insert(rollCallEvents).values({
      shopId: shop.id,
      tripId: trip.id,
      bookingId: booking.id,
      recordedByPersonId: staff.person.id,
      status,
      checkpoint,
      occurredAt,
    });
  return { db, trip, mark };
}

const pass = async (db: ReturnType<typeof fileScopedShopContext>["db"], now: Date) => {
  const { sent, provider } = recorder();
  await sendStaleRollCallAlerts(db, { now, origin: ORIGIN, provider });
  return sent.filter((n) => n.kind === "roll_call_stale");
};

describe("stale roll-call alerts on a course that meets on two Saturdays", () => {
  it("alerts about the first Saturday's open count after that Saturday, not a fortnight on", async () => {
    const { db, trip, mark } = await course();
    await mark("departure", "boarded", new Date(DAY_ONE.startsAt.getTime() - 10 * 60_000));
    const sent = await pass(db, new Date(DAY_ONE.endsAt.getTime() + 2 * HOUR));
    expect(sent.length).toBeGreaterThan(0);
    expect(sent[0]).toMatchObject({ tripId: trip.id, endsAt: DAY_ONE.endsAt, awaiting: 1 });
  });

  it("alerts again about the second Saturday, which the first's claim does not hold", async () => {
    const { db, mark } = await course();
    await mark("departure", "boarded", new Date(DAY_ONE.startsAt.getTime() - 10 * 60_000));
    expect((await pass(db, new Date(DAY_ONE.endsAt.getTime() + 2 * HOUR))).length).toBeGreaterThan(
      0,
    );
    // Wednesday between: nothing more to say.
    expect(await pass(db, new Date("2031-03-08T15:00:00Z"))).toEqual([]);
    // Second Saturday: counted back after day one's dive is not day two's.
    await mark("after_dive_1", "boarded", new Date(DAY_ONE.startsAt.getTime() + HOUR));
    await mark("departure", "boarded", new Date(DAY_TWO.startsAt.getTime() - 10 * 60_000));
    // Still out on the water: not due yet.
    expect(await pass(db, new Date(DAY_TWO.startsAt.getTime() + HOUR))).toEqual([]);
    const sent = await pass(db, new Date(DAY_TWO.endsAt.getTime() + 2 * HOUR));
    expect(sent.length).toBeGreaterThan(0);
    expect(sent[0]).toMatchObject({ endsAt: DAY_TWO.endsAt, awaiting: 1 });
    // And once per day: the next pass is quiet.
    expect(await pass(db, new Date(DAY_TWO.endsAt.getTime() + 3 * HOUR))).toEqual([]);
  });
});
