import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seedRollCallEvidence } from "@/db/seed-roll-call-evidence";
import { bookings, people, shops, tripScheduleDays, trips } from "../../db/schema/index";
import { listStaff } from "../../db/trips";
import type { Notification, NotificationProvider } from "../../lib/notifications/index";
import { fileScopedShopContext } from "../../test/db";
import { sendStaleRollCallAlerts } from "./store";

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

async function course(days = [DAY_ONE, DAY_TWO], divers = 1) {
  const { db, shop } = ctx;
  await db.update(shops).set({ isDemo: false }).where(eq(shops.id, shop.id));
  const [trip] = await db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Open Water, two Saturdays",
      startsAt: days[0]?.startsAt ?? DAY_ONE.startsAt,
      endsAt: days.at(-1)?.endsAt ?? DAY_TWO.endsAt,
      capacity: 6,
      plannedDives: 1,
    })
    .returning();
  if (!trip) throw new Error("trip insert failed");
  await db
    .insert(tripScheduleDays)
    .values(days.map((day, index) => ({ tripId: trip.id, dayNumber: index + 1, ...day })));
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("fixture staff missing");
  const marks: ((
    checkpoint: string,
    status: "boarded" | "not_boarded",
    occurredAt: Date,
  ) => Promise<unknown>)[] = [];
  for (let index = 0; index < divers; index++) {
    const [person] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: index === 0 ? "Ana Ruiz" : `Diver ${index + 1}` })
      .returning();
    if (!person) throw new Error("fixture person missing");
    const [booking] = await db
      .insert(bookings)
      .values({ bookedAs: "diver", shopId: shop.id, tripId: trip.id, personId: person.id })
      .returning();
    if (!booking) throw new Error("booking insert failed");
    marks.push((checkpoint, status, occurredAt) =>
      seedRollCallEvidence(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: booking.id,
        recordedByPersonId: staff.person.id,
        status,
        checkpoint,
        occurredAt,
      }),
    );
  }
  const [mark] = marks;
  if (!mark) throw new Error("no diver");
  return { db, trip, mark, marks };
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

  // A course with a morning and an afternoon session on one Saturday: both
  // days sit inside the alert's look-back at once (#2557 review).
  const MORNING = {
    startsAt: new Date("2031-04-05T09:00:00Z"),
    endsAt: new Date("2031-04-05T11:00:00Z"),
  };
  const AFTERNOON = {
    startsAt: new Date("2031-04-05T13:00:00Z"),
    endsAt: new Date("2031-04-05T15:00:00Z"),
  };
  const minutes = (base: Date, count: number) => new Date(base.getTime() + count * 60_000);

  it("does not let the morning's missing diver silence the afternoon's open count", async () => {
    const { db, marks } = await course([MORNING, AFTERNOON], 2);
    const [missing, other] = marks as [(typeof marks)[number], (typeof marks)[number]];
    await missing("departure", "boarded", minutes(MORNING.startsAt, -10));
    await other("departure", "boarded", minutes(MORNING.startsAt, -10));
    await missing("after_dive_1", "not_boarded", minutes(MORNING.startsAt, 60));
    await other("after_dive_1", "boarded", minutes(MORNING.startsAt, 61));
    const morning = await pass(db, minutes(MORNING.endsAt, 60));
    expect(morning[0]).toMatchObject({ endsAt: MORNING.endsAt, notBackAboard: 1 });
    // Afternoon: the other diver boards and is never counted back.
    await other("departure", "boarded", minutes(AFTERNOON.startsAt, -10));
    const afternoon = await pass(db, minutes(AFTERNOON.endsAt, 120));
    expect(afternoon.length).toBeGreaterThan(0);
    expect(afternoon[0]).toMatchObject({ endsAt: AFTERNOON.endsAt, awaiting: 1 });
  });

  it("does not let a morning alert sent after the afternoon began hold the afternoon", async () => {
    const { db, mark } = await course([MORNING, AFTERNOON]);
    await mark("departure", "boarded", minutes(MORNING.startsAt, -10));
    // The morning's alert goes late, half an hour into the afternoon.
    const morning = await pass(db, minutes(AFTERNOON.startsAt, 30));
    expect(morning[0]).toMatchObject({ endsAt: MORNING.endsAt });
    await mark("after_dive_1", "boarded", minutes(MORNING.startsAt, 60));
    await mark("departure", "boarded", minutes(AFTERNOON.startsAt, -10));
    const afternoon = await pass(db, minutes(AFTERNOON.endsAt, 120));
    expect(afternoon.length).toBeGreaterThan(0);
    expect(afternoon[0]).toMatchObject({ endsAt: AFTERNOON.endsAt, awaiting: 1 });
  });
});
