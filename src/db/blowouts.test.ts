import { and, eq, like } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import type { Notification } from "@/lib/notifications";
import { seededShopContext } from "@/test/db";
import { fakeEmail } from "@/test/fakes";
import { callTripBlowout, getTripBlowout, hasTripBlowout, resumeTripBlowout } from "./blowouts";
import { createBookingParty } from "./bookings";
import { drainNotificationRetries } from "./notifications";
import { setBookingPayment } from "./payments";
import { notificationSendQueue, people, trips as tripsTable } from "./schema";
import { createTrip, upcomingTripsWithCounts } from "./trips";

const ORIGIN = "https://diveday.example";
const HOUR = 60 * 60 * 1_000;

beforeEach(() => {
  vi.stubEnv("APP_HOST", ORIGIN);
});

type Ctx = Awaited<ReturnType<typeof context>>;

/**
 * A fresh charter departing tomorrow with a controllable roster, inside the
 * seeded Blue Mantis world (whose upcoming schedule provides the rebooking
 * candidates), plus the seeded owner as the staff member making the call.
 */
async function context(divers: { fullName: string; email?: string }[] = []) {
  const { db, shop } = await seededShopContext();
  const now = nowDate();
  const trip = await createTrip(db, {
    shopId: shop.id,
    title: "Storm-Test Two-Tank",
    startsAt: new Date(now.getTime() + 20 * HOUR),
    endsAt: new Date(now.getTime() + 24 * HOUR),
    capacity: 12,
    plannedDives: 2,
  });
  if (!trip) throw new Error("test trip could not be created");
  const bookingIds: string[] = [];
  if (divers.length > 0) {
    const party = await createBookingParty(
      db,
      divers.map((diver) => ({
        actor: "staff" as const,
        shopId: shop.id,
        tripId: trip.id,
        fullName: diver.fullName,
        email: diver.email,
      })),
    );
    if (!party.ok) throw new Error(`test roster could not be booked: ${party.reason}`);
    bookingIds.push(...party.bookings.map((b) => b.bookingId));
  }
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Dana Reyes")))
    .limit(1);
  if (!owner) throw new Error("seeded owner missing");
  return { db, shop, trip, bookingIds, now, ownerId: owner.id };
}

function callInput(ctx: Ctx, provider: ReturnType<typeof fakeEmail>["provider"]) {
  return {
    shopId: ctx.shop.id,
    tripId: ctx.trip.id,
    calledByPersonId: ctx.ownerId,
    provider,
  };
}

const blowoutSends = (sent: Notification[]) =>
  sent.filter(
    (n): n is Extract<Notification, { kind: "trip_blowout" }> => n.kind === "trip_blowout",
  );

describe("callTripBlowout — the one-tap cascade", () => {
  it("cancels the trip, snapshots the roster, and sends each diver one message", async () => {
    const ctx = await context([
      { fullName: "Ada Storm", email: "ada.storm@example.com" },
      { fullName: "Ben Gale", email: "ben.gale@example.com" },
    ]);
    const email = fakeEmail();
    const outcome = await callTripBlowout(ctx.db, callInput(ctx, email.provider));

    expect(outcome).toMatchObject({ ok: true, resumed: false, total: 2, sent: 2 });
    const [trip] = await ctx.db
      .select({ status: tripsTable.status })
      .from(tripsTable)
      .where(eq(tripsTable.id, ctx.trip.id));
    expect(trip.status).toBe("cancelled");

    const sends = blowoutSends(email.sent);
    expect(sends).toHaveLength(2);
    for (const send of sends) {
      // Alternatives are near-future public booking links — never the
      // cancelled trip itself, never more than the cap.
      expect(send.alternatives.length).toBeLessThanOrEqual(3);
      for (const alternative of send.alternatives) {
        expect(alternative.bookingUrl).toContain(`${ORIGIN}/s/${ctx.shop.slug}/trips/`);
        expect(alternative.bookingUrl).not.toContain(ctx.trip.id);
      }
      expect(send.scheduleUrl).toBe(`${ORIGIN}/s/${ctx.shop.slug}`);
      // These new-to-the-shop divers have no captured payment.
      expect(send.paymentStory).toBe("none");
    }

    const record = await getTripBlowout(ctx.db, ctx.shop.id, ctx.trip.id);
    expect(record?.divers).toHaveLength(2);
    expect(record?.divers.every((diver) => diver.messageStatus === "sent")).toBe(true);
    expect(record?.divers.every((diver) => diver.notifiedAt !== null)).toBe(true);
  });

  it("is idempotent: calling again resumes and re-sends nobody", async () => {
    const ctx = await context([{ fullName: "Ada Storm", email: "ada.storm@example.com" }]);
    const first = fakeEmail();
    await callTripBlowout(ctx.db, callInput(ctx, first.provider));
    expect(blowoutSends(first.sent)).toHaveLength(1);

    const second = fakeEmail();
    const outcome = await callTripBlowout(ctx.db, callInput(ctx, second.provider));
    expect(outcome).toMatchObject({ ok: true, resumed: true, total: 1, sent: 0 });
    expect(blowoutSends(second.sent)).toHaveLength(0);
  });

  it("a trip with zero bookings is a clean no-op cascade, not a crash", async () => {
    const ctx = await context([]);
    const email = fakeEmail();
    const outcome = await callTripBlowout(ctx.db, callInput(ctx, email.provider));
    expect(outcome).toMatchObject({ ok: true, total: 0, sent: 0 });
    expect(email.sent).toHaveLength(0);
    const [trip] = await ctx.db
      .select({ status: tripsTable.status })
      .from(tripsTable)
      .where(eq(tripsTable.id, ctx.trip.id));
    expect(trip.status).toBe("cancelled");
    expect(await hasTripBlowout(ctx.db, ctx.shop.id, ctx.trip.id)).toBe(true);
  });

  it("refuses an unknown trip and another shop's trip id", async () => {
    const ctx = await context([]);
    const email = fakeEmail();
    expect(
      await callTripBlowout(ctx.db, {
        ...callInput(ctx, email.provider),
        tripId: "00000000-0000-4000-8000-000000000001",
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(
      await callTripBlowout(ctx.db, {
        ...callInput(ctx, email.provider),
        shopId: "00000000-0000-4000-8000-000000000002",
      }),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses to blow out a departed trip", async () => {
    const ctx = await context([]);
    await ctx.db
      .update(tripsTable)
      .set({
        startsAt: new Date(ctx.now.getTime() - 4 * HOUR),
        endsAt: new Date(ctx.now.getTime() - 1 * HOUR),
      })
      .where(eq(tripsTable.id, ctx.trip.id));
    const email = fakeEmail();
    expect(await callTripBlowout(ctx.db, callInput(ctx, email.provider))).toEqual({
      ok: false,
      reason: "trip_departed",
    });
    const [trip] = await ctx.db
      .select({ status: tripsTable.status })
      .from(tripsTable)
      .where(eq(tripsTable.id, ctx.trip.id));
    expect(trip.status).toBe("scheduled");
  });

  it("a diver with no email is surfaced as no_email, with offers still computed", async () => {
    const ctx = await context([
      { fullName: "Walk-In Wanda" },
      { fullName: "Ben Gale", email: "ben.gale@example.com" },
    ]);
    const email = fakeEmail();
    const outcome = await callTripBlowout(ctx.db, callInput(ctx, email.provider));
    expect(outcome).toMatchObject({ ok: true, total: 2, sent: 1, noEmail: 1 });
    const record = await getTripBlowout(ctx.db, ctx.shop.id, ctx.trip.id);
    const wanda = record?.divers.find((diver) => diver.fullName === "Walk-In Wanda");
    expect(wanda?.messageStatus).toBe("no_email");
    // Staff can still see what to offer her over the phone.
    expect(wanda?.offeredTrips.length).toBeGreaterThan(0);
  });
});

describe("callTripBlowout — failure semantics (resume, never re-send)", () => {
  it("a mid-cascade hard failure leaves only that diver retryable, and resume sends only them", async () => {
    const ctx = await context([
      { fullName: "Ada Storm", email: "ada.storm@example.com" },
      { fullName: "Ben Gale", email: "ben.gale@example.com" },
      { fullName: "Cy Reef", email: "cy.reef@example.com" },
    ]);
    const flaky = fakeEmail(undefined, {
      async send(notification) {
        if (notification.to === "ben.gale@example.com") {
          return { status: "failed", retryable: false, errorCode: "boom" };
        }
        return { status: "sent", providerMessageId: "em_ok" };
      },
    });
    const first = await callTripBlowout(ctx.db, callInput(ctx, flaky.provider));
    expect(first).toMatchObject({ ok: true, total: 3, sent: 2, failed: 1 });

    const healthy = fakeEmail();
    const second = await resumeTripBlowout(ctx.db, callInput(ctx, healthy.provider));
    expect(second).toMatchObject({ ok: true, resumed: true, total: 3, sent: 1 });
    const resent = blowoutSends(healthy.sent);
    expect(resent).toHaveLength(1);
    expect(resent[0].to).toBe("ben.gale@example.com");

    const record = await getTripBlowout(ctx.db, ctx.shop.id, ctx.trip.id);
    expect(record?.divers.every((diver) => diver.messageStatus === "sent")).toBe(true);
  });

  it("two concurrent calls claim each diver once — nobody is double-messaged", async () => {
    const ctx = await context([
      { fullName: "Ada Storm", email: "ada.storm@example.com" },
      { fullName: "Ben Gale", email: "ben.gale@example.com" },
    ]);
    const email = fakeEmail();
    const [first, second] = await Promise.all([
      callTripBlowout(ctx.db, callInput(ctx, email.provider)),
      callTripBlowout(ctx.db, callInput(ctx, email.provider)),
    ]);
    expect(first.ok && second.ok).toBe(true);
    // Between the two racing passes, each diver's message went out exactly once.
    expect(blowoutSends(email.sent)).toHaveLength(2);
    const record = await getTripBlowout(ctx.db, ctx.shop.id, ctx.trip.id);
    expect(record?.divers.every((diver) => diver.messageStatus === "sent")).toBe(true);
  });

  it("a retryable failure hands the send to the durable queue — resume never races it", async () => {
    const ctx = await context([{ fullName: "Ada Storm", email: "ada.storm@example.com" }]);
    const down = fakeEmail({ status: "failed", retryable: true, errorCode: "throttled" });
    const first = await callTripBlowout(ctx.db, callInput(ctx, down.provider));
    expect(first).toMatchObject({ ok: true, total: 1, queued: 1 });

    const record = await getTripBlowout(ctx.db, ctx.shop.id, ctx.trip.id);
    expect(record?.divers[0].messageStatus).toBe("queued");
    const queueRows = await ctx.db
      .select()
      .from(notificationSendQueue)
      .where(like(notificationSendQueue.idempotencyKey, "trip-blowout/%"));
    expect(queueRows).toHaveLength(1);

    // A resume sends nothing new: the queue owns this diver's message now.
    const healthy = fakeEmail();
    const resumed = await resumeTripBlowout(ctx.db, callInput(ctx, healthy.provider));
    expect(resumed).toMatchObject({ ok: true, sent: 0, queued: 0, failed: 0 });
    expect(blowoutSends(healthy.sent)).toHaveLength(0);

    // The queue drain revives the payload (nested alternative dates included)
    // and delivers the one message.
    const drainProvider = fakeEmail();
    const summary = await drainNotificationRetries(ctx.db, {
      now: new Date(nowDate().getTime() + 2 * HOUR),
      provider: drainProvider.provider,
    });
    const drained = blowoutSends(drainProvider.sent);
    expect(summary.sent).toBeGreaterThanOrEqual(1);
    expect(drained).toHaveLength(1);
    for (const alternative of drained[0].alternatives) {
      expect(alternative.startsAt).toBeInstanceOf(Date);
    }
  });
});

describe("callTripBlowout — what the message says", () => {
  it("filters each diver's alternatives through trip admission (Diego never sees the Advanced wall)", async () => {
    const { db, shop } = await seededShopContext();
    const now = nowDate();
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Storm-Test Two-Tank",
      startsAt: new Date(now.getTime() + 20 * HOUR),
      endsAt: new Date(now.getTime() + 24 * HOUR),
      capacity: 12,
      plannedDives: 2,
    });
    if (!trip) throw new Error("test trip could not be created");
    // Diego Alvarez is the seed's verified Open Water diver (seed-cert-gates):
    // booking him by his seeded email reuses his person row and his cards.
    const party = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Diego Alvarez",
        email: "diego.alvarez@example.com",
      },
    ]);
    if (!party.ok) throw new Error(`Diego could not be booked: ${party.reason}`);
    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Dana Reyes")))
      .limit(1);

    const gated = await db
      .select({ id: tripsTable.id, title: tripsTable.title })
      .from(tripsTable)
      .where(and(eq(tripsTable.shopId, shop.id), like(tripsTable.title, "Advanced Drift%")));
    expect(gated).toHaveLength(1);

    const email = fakeEmail();
    const outcome = await callTripBlowout(db, {
      shopId: shop.id,
      tripId: trip.id,
      calledByPersonId: owner.id,
      provider: email.provider,
    });
    expect(outcome).toMatchObject({ ok: true, sent: 1 });
    const [send] = blowoutSends(email.sent);
    expect(send.to).toBe("diego.alvarez@example.com");
    expect(send.alternatives.length).toBeGreaterThan(0);
    for (const alternative of send.alternatives) {
      expect(alternative.title).not.toBe(gated[0].title);
      expect(alternative.bookingUrl).not.toContain(gated[0].id);
    }
  });

  it("tells a paid diver their money story without moving any money", async () => {
    const ctx = await context([{ fullName: "Ada Storm", email: "ada.storm@example.com" }]);
    await setBookingPayment(ctx.db, {
      shopId: ctx.shop.id,
      bookingId: ctx.bookingIds[0],
      status: "paid",
      amountCents: 15_000,
      currency: "usd",
    });
    const email = fakeEmail();
    await callTripBlowout(ctx.db, callInput(ctx, email.provider));
    const [send] = blowoutSends(email.sent);
    expect(send.paymentStory).toBe("paid");
    // The payment row is untouched — no refund, no forfeit, no status change.
    const record = await getTripBlowout(ctx.db, ctx.shop.id, ctx.trip.id);
    expect(record?.divers[0].paymentStatus).toBe("paid");
  });

  it("the cascade record reports a diver as rebooked once they hold another upcoming seat", async () => {
    const ctx = await context([{ fullName: "Ada Storm", email: "ada.storm@example.com" }]);
    const email = fakeEmail();
    await callTripBlowout(ctx.db, callInput(ctx, email.provider));

    let record = await getTripBlowout(ctx.db, ctx.shop.id, ctx.trip.id);
    expect(record?.divers[0].rebooked).toBe(false);

    // Ada rebooks herself onto another upcoming departure via the public flow's
    // email-reuse path.
    const alternatives = await upcomingTripsWithCounts(ctx.db, ctx.shop.id, nowDate());
    const target = alternatives.find(
      (candidate) => candidate.id !== ctx.trip.id && candidate.booked < candidate.capacity,
    );
    if (!target) throw new Error("no rebookable seeded trip");
    const rebook = await createBookingParty(ctx.db, [
      {
        actor: "public",
        shopId: ctx.shop.id,
        tripId: target.id,
        fullName: "Ada Storm",
        email: "ada.storm@example.com",
      },
    ]);
    expect(rebook.ok).toBe(true);

    record = await getTripBlowout(ctx.db, ctx.shop.id, ctx.trip.id);
    expect(record?.divers[0].rebooked).toBe(true);
  });
});
