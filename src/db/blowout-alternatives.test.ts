import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import type { Notification, NotificationProvider } from "@/lib/notifications";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail } from "@/test/fakes";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import { listNonBoatOfferOptions } from "./blowout-alternatives";
import { callDayBlowout, callTripBlowout, resumeTripBlowout } from "./blowouts";
import { createBooking } from "./bookings";
import { recordRollCall } from "./manifests";
import { shops, tripBlowoutDivers, tripBlowouts, trips } from "./schema";
import { createTrip } from "./trips";

const context = fileScopedShopContext();
const HOUR = 3600000;
beforeEach(() => vi.stubEnv("APP_HOST", "https://diveday.example"));
async function setup(count = 1) {
  const { db, shop } = context;
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  const departure = async (
    title: string,
    hours: number,
    diveMode: "boat" | "shore" | "pool",
    capacity = 8,
    shopId = shop.id,
  ) => {
    const trip = await createTrip(db, {
      shopId,
      title,
      diveMode,
      capacity,
      plannedDives: 1,
      startsAt: new Date(nowDate().getTime() + hours * HOUR),
      endsAt: new Date(nowDate().getTime() + (hours + 2) * HOUR),
    });
    if (!trip) throw new Error("missing trip");
    return trip;
  };
  const source = await departure("Canceled charter", 4, "boat");
  const shore = await departure("Preferred shore dive", 96, "shore");
  const pool = await departure("Preferred pool session", 120, "pool", 1);
  const bookingIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const seat = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: source.id,
      fullName: `Storm Diver ${i}`,
      email: `weather-selection-${i}@example.com`,
    });
    if (!seat.ok) throw new Error(`seat ${seat.reason}`);
    bookingIds.push(seat.bookingId);
  }
  const input = {
    shopId: shop.id,
    tripId: source.id,
    calledByPersonId: owner,
    refunds: "queue" as const,
  };
  return { db, shop, owner, source, shore, pool, bookingIds, input, departure };
}
const messages = (sent: Notification[]) =>
  sent.filter(
    (n): n is Extract<Notification, { kind: "trip_blowout" }> => n.kind === "trip_blowout",
  );

describe("staff-selected non-boat recovery offers", () => {
  it("prioritizes the selected shore trip in the existing public booking links and snapshot", async () => {
    const { db, shore, input } = await setup();
    const email = fakeEmail();
    expect(
      await callTripBlowout(db, {
        ...input,
        preferredAlternativeTripIds: [shore.id],
        provider: email.provider,
      }),
    ).toMatchObject({ ok: true, sent: 1 });
    expect(messages(email.sent)[0].alternatives[0]).toMatchObject({
      title: shore.title,
      bookingUrl: expect.stringContaining(`/trips/${shore.id}`),
    });
    const [call] = await db
      .select()
      .from(tripBlowouts)
      .where(eq(tripBlowouts.tripId, input.tripId));
    const [diver] = await db
      .select()
      .from(tripBlowoutDivers)
      .where(eq(tripBlowoutDivers.blowoutId, call.id));
    expect(call.preferredAlternativeTripIds).toEqual([shore.id]);
    expect(diver.offeredTripIds[0]).toBe(shore.id);
  });

  it("retains the first call's preference while resuming pending messages with changed input", async () => {
    const { db, shore, pool, input } = await setup();
    vi.stubEnv("APP_HOST", "");
    await callTripBlowout(db, { ...input, preferredAlternativeTripIds: [shore.id] });
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const email = fakeEmail();
    expect(
      await callTripBlowout(db, {
        ...input,
        preferredAlternativeTripIds: [pool.id],
        provider: email.provider,
      }),
    ).toMatchObject({ ok: true, resumed: true, sent: 1 });
    expect(messages(email.sent)[0].alternatives[0].title).toBe(shore.title);
    const [call] = await db
      .select()
      .from(tripBlowouts)
      .where(eq(tripBlowouts.tripId, input.tripId));
    expect(call.preferredAlternativeTripIds).toEqual([shore.id]);
  });

  it("rechecks availability per recipient when the selected pool fills during the cascade", async () => {
    const { db, pool, shop, input } = await setup(2);
    const sent: Notification[] = [];
    const provider: NotificationProvider = {
      async send(notification) {
        sent.push(notification);
        if (notification.kind === "trip_blowout" && messages(sent).length === 1) {
          const occupied = await createBooking(db, {
            actor: "staff",
            shopId: shop.id,
            tripId: pool.id,
            fullName: "Last pool place taken",
          });
          expect(occupied.ok).toBe(true);
        }
        return { status: "sent", providerMessageId: `offer-${sent.length}` };
      },
    };
    expect(
      await callTripBlowout(db, { ...input, preferredAlternativeTripIds: [pool.id], provider }),
    ).toMatchObject({ ok: true, sent: 2 });
    const offers = messages(sent);
    expect(offers[0].alternatives[0].title).toBe(pool.title);
    expect(offers[1].alternatives.some((offer) => offer.title === pool.title)).toBe(false);
  });

  it("excludes same-batch cancellations even when submitted as priority alternatives", async () => {
    const { db, shore, pool, input } = await setup();
    const email = fakeEmail();
    const results = await callDayBlowout(db, {
      ...input,
      tripIds: [input.tripId, shore.id],
      preferredAlternativeTripIds: [shore.id, pool.id],
      provider: email.provider,
    });
    expect(results.every((result) => result.outcome.ok)).toBe(true);
    expect(messages(email.sent)[0].alternatives[0].title).toBe(pool.title);
    expect(messages(email.sent)[0].alternatives.some((offer) => offer.title === shore.title)).toBe(
      false,
    );
    const [call] = await db
      .select()
      .from(tripBlowouts)
      .where(eq(tripBlowouts.tripId, input.tripId));
    expect(call.preferredAlternativeTripIds).toEqual([pool.id]);
  });

  it("does not rewrite queued offer snapshots or send again on resume", async () => {
    const { db, shore, pool, input } = await setup();
    const down = fakeEmail({ status: "failed", retryable: true, errorCode: "throttled" });
    await callTripBlowout(db, {
      ...input,
      preferredAlternativeTripIds: [shore.id],
      provider: down.provider,
    });
    const [call] = await db
      .select()
      .from(tripBlowouts)
      .where(eq(tripBlowouts.tripId, input.tripId));
    const before = await db
      .select()
      .from(tripBlowoutDivers)
      .where(eq(tripBlowoutDivers.blowoutId, call.id));
    expect(before[0].messageStatus).toBe("queued");
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, shore.id));
    const email = fakeEmail();
    await callTripBlowout(db, {
      ...input,
      preferredAlternativeTripIds: [pool.id],
      provider: email.provider,
    });
    await resumeTripBlowout(db, { ...input, provider: email.provider });
    expect(messages(email.sent)).toHaveLength(0);
    expect(
      await db.select().from(tripBlowoutDivers).where(eq(tripBlowoutDivers.blowoutId, call.id)),
    ).toEqual(before);
  });

  it("rejects foreign choices before cancellation without persisting or exposing their ids", async () => {
    const { db, input, departure } = await setup();
    const [foreign] = await db
      .insert(shops)
      .values({ name: "Other shop", slug: `other-${randomUUID()}`, timezone: "America/New_York" })
      .returning();
    const target = await departure("Private foreign pool", 100, "pool", 4, foreign.id);
    const email = fakeEmail();
    expect(
      await callTripBlowout(db, {
        ...input,
        preferredAlternativeTripIds: [target.id],
        provider: email.provider,
      }),
    ).toEqual({ ok: false, reason: "invalid_alternatives" });
    expect(messages(email.sent)).toEqual([]);
    expect(
      await db.select().from(tripBlowouts).where(eq(tripBlowouts.tripId, input.tripId)),
    ).toEqual([]);
    expect((await db.select().from(trips).where(eq(trips.id, input.tripId)))[0].status).toBe(
      "scheduled",
    );
  });

  it("never offers or changes an underway departure, and validates preference shape before cancellation", async () => {
    const { db, shop, source, shore, owner, bookingIds, input } = await setup();
    expect(
      (
        await recordRollCall(db, {
          shopId: shop.id,
          tripId: source.id,
          bookingId: bookingIds[0],
          recordedByPersonId: owner,
          status: "not_boarded",
        })
      ).ok,
    ).toBe(true);
    expect(
      await callTripBlowout(db, {
        ...input,
        preferredAlternativeTripIds: [shore.id],
        provider: fakeEmail().provider,
      }),
    ).toEqual({ ok: false, reason: "trip_departed" });
    expect(await callTripBlowout(db, { ...input, preferredAlternativeTripIds: ["bad"] })).toEqual({
      ok: false,
      reason: "invalid_alternatives",
    });
    expect(
      await db
        .select()
        .from(tripBlowouts)
        .where(and(eq(tripBlowouts.tripId, source.id), eq(tripBlowouts.shopId, shop.id))),
    ).toEqual([]);
    expect((await db.select().from(trips).where(eq(trips.id, source.id)))[0].status).toBe(
      "scheduled",
    );
  });

  it("the picker lists only current non-boat noncourse options and omits full or canceled choices", async () => {
    const { db, shop, shore, pool, source } = await setup();
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, pool.id));
    const options = await listNonBoatOfferOptions(db, shop.id, nowDate(), [source.id]);
    expect(options.some((option) => option.id === shore.id)).toBe(true);
    expect(options.some((option) => option.id === pool.id || option.id === source.id)).toBe(false);
    expect(
      options.every((option) => option.diveMode === "shore" || option.diveMode === "pool"),
    ).toBe(true);
  });
  it("retains same-call exclusion when a sister is reinstated before a pending cascade resumes", async () => {
    const { db, shore, pool, input } = await setup();
    await db
      .update(trips)
      .set({ startsAt: new Date(nowDate().getTime() + 5 * HOUR) })
      .where(eq(trips.id, shore.id));
    vi.stubEnv("APP_HOST", "");
    await callDayBlowout(db, {
      ...input,
      tripIds: [input.tripId, shore.id],
      preferredAlternativeTripIds: [pool.id],
    });
    await db.update(trips).set({ status: "scheduled" }).where(eq(trips.id, shore.id));
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const email = fakeEmail();
    await resumeTripBlowout(db, { ...input, provider: email.provider });
    expect(messages(email.sent)[0].alternatives.some((offer) => offer.title === shore.title)).toBe(
      false,
    );
  });
});
