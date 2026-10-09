import { and, eq, inArray, like } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import type { Notification } from "@/lib/notifications";
import { seededShopContext } from "@/test/db";
import { fakeCheckout, fakeEmail } from "@/test/fakes";
import {
  callDayBlowout,
  callTripBlowout,
  getTripBlowout,
  hasTripBlowout,
  listDayBlowoutDepartures,
  resumeTripBlowout,
} from "./blowouts";
import { createBookingParty } from "./bookings";
import { recordRollCall } from "./manifests";
import { drainNotificationRetries } from "./notifications";
import { setBookingPayment } from "./payments";
import { crewNotices, notificationSendQueue, people, trips as tripsTable } from "./schema";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import { createTrip, upcomingTripsWithCounts } from "./trips";
import { changeTripCrew, listStaff } from "./trips-crew";

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

/** A payable shop, so the cascade has a card path to reverse a capture through. */
async function connectStripe(ctx: Ctx) {
  await upsertShopStripeAccount(ctx.db, ctx.shop.id, "acct_blowout");
  await setShopStripeAccountStatus(ctx.db, "acct_blowout", {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
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
    // booking him by his seeded (simulator) email reuses his person row and his cards.
    const party = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Diego Alvarez",
        email: "diego.alvarez@mail.example",
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
    expect(send.to).toBe("diego.alvarez@mail.example");
    expect(send.alternatives.length).toBeGreaterThan(0);
    for (const alternative of send.alternatives) {
      expect(alternative.title).not.toBe(gated[0].title);
      expect(alternative.bookingUrl).not.toContain(gated[0].id);
    }
  });

  it("tells a counter-paid diver the shop owes them, and leaves the money where staff can see it", async () => {
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
    // Cash at the counter: there is no card to reverse, so the diver is told
    // plainly that a refund is owed rather than that it has happened.
    expect(send.paymentStory).toBe("refund_owed");
    const record = await getTripBlowout(ctx.db, ctx.shop.id, ctx.trip.id);
    expect(record?.divers[0].paymentStatus).toBe("paid");
  });

  it("refunds a Stripe-paid seat by itself and says so — the shop canceled, so no window applies", async () => {
    const ctx = await context([{ fullName: "Ada Storm", email: "ada.storm@example.com" }]);
    await connectStripe(ctx);
    await setBookingPayment(ctx.db, {
      shopId: ctx.shop.id,
      bookingId: ctx.bookingIds[0],
      status: "paid",
      amountCents: 15_000,
      currency: "usd",
      provider: "stripe",
      providerRef: "cs_paid",
    });
    const email = fakeEmail();
    await callTripBlowout(ctx.db, {
      ...callInput(ctx, email.provider),
      checkout: fakeCheckout(),
    });
    const [send] = blowoutSends(email.sent);
    expect(send.paymentStory).toBe("refunded");
    const record = await getTripBlowout(ctx.db, ctx.shop.id, ctx.trip.id);
    expect(record?.divers[0].paymentStatus).toBe("refunded");
  });

  it("says nothing about money to a diver who never paid", async () => {
    const ctx = await context([{ fullName: "Ada Storm", email: "ada.storm@example.com" }]);
    const email = fakeEmail();
    await callTripBlowout(ctx.db, callInput(ctx, email.provider));
    expect(blowoutSends(email.sent)[0].paymentStory).toBe("none");
  });

  it("refunds once across a resume, however many times the cascade is worked", async () => {
    const ctx = await context([{ fullName: "Ada Storm", email: "ada.storm@example.com" }]);
    await connectStripe(ctx);
    await setBookingPayment(ctx.db, {
      shopId: ctx.shop.id,
      bookingId: ctx.bookingIds[0],
      status: "paid",
      amountCents: 15_000,
      currency: "usd",
      provider: "stripe",
      providerRef: "cs_resume",
    });
    let refundCalls = 0;
    const checkout = fakeCheckout({
      async refundCheckoutSession() {
        refundCalls += 1;
        return { status: "refunded", refundId: "re_resume" };
      },
    });
    const email = fakeEmail();
    await callTripBlowout(ctx.db, { ...callInput(ctx, email.provider), checkout });
    await resumeTripBlowout(ctx.db, { ...callInput(ctx, email.provider), checkout });
    expect(refundCalls).toBe(1);
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

describe("callDayBlowout — one weather call for several departures", () => {
  /** Another departure of the same morning, with its own booked diver. */
  async function sister(ctx: Ctx, title: string, hoursOut: number, diver?: string) {
    const trip = await createTrip(ctx.db, {
      shopId: ctx.shop.id,
      title,
      startsAt: new Date(ctx.now.getTime() + hoursOut * HOUR),
      endsAt: new Date(ctx.now.getTime() + (hoursOut + 2) * HOUR),
      capacity: 12,
      plannedDives: 2,
    });
    if (!trip) throw new Error("sister trip could not be created");
    if (diver) {
      const party = await createBookingParty(ctx.db, [
        {
          actor: "staff" as const,
          shopId: ctx.shop.id,
          tripId: trip.id,
          fullName: diver,
          email: `${diver.toLowerCase().replace(/\W+/g, ".")}@example.com`,
        },
      ]);
      if (!party.ok) throw new Error(`sister roster could not be booked: ${party.reason}`);
    }
    return trip;
  }

  it("cancels every departure called, and offers no diver a sister the same call cancels", async () => {
    const ctx = await context([{ fullName: "Ada Storm", email: "ada.storm@example.com" }]);
    const second = await sister(ctx, "Storm-Test Second Boat", 21, "Ben Gale");
    // Left standing: the one boat of the morning the call does not touch.
    const spared = await sister(ctx, "Storm-Test Spared Boat", 21.5);
    const email = fakeEmail();

    const results = await callDayBlowout(ctx.db, {
      shopId: ctx.shop.id,
      tripIds: [ctx.trip.id, second.id],
      calledByPersonId: ctx.ownerId,
      provider: email.provider,
    });

    expect(results.map((row) => [row.tripId, row.outcome.ok])).toEqual([
      [ctx.trip.id, true],
      [second.id, true],
    ]);
    const statuses = await ctx.db
      .select({ id: tripsTable.id, status: tripsTable.status })
      .from(tripsTable)
      .where(inArray(tripsTable.id, [ctx.trip.id, second.id, spared.id]));
    expect(Object.fromEntries(statuses.map((row) => [row.id, row.status]))).toEqual({
      [ctx.trip.id]: "cancelled",
      [second.id]: "cancelled",
      [spared.id]: "scheduled",
    });

    const sends = blowoutSends(email.sent);
    expect(sends.map((send) => send.diverName).sort()).toEqual(["Ada Storm", "Ben Gale"]);
    const offered = sends.flatMap((send) => send.alternatives.map((alt) => alt.bookingUrl));
    // The spared boat is still a plan, and the soonest one: it is offered…
    expect(offered.some((url) => url.endsWith(`/trips/${spared.id}`))).toBe(true);
    // …and neither boat this call cancels is offered to anybody.
    expect(offered.some((url) => url.includes(ctx.trip.id))).toBe(false);
    expect(offered.some((url) => url.includes(second.id))).toBe(false);

    // Each departure has its own ordinary cascade record.
    expect((await getTripBlowout(ctx.db, ctx.shop.id, ctx.trip.id))?.divers).toHaveLength(1);
    expect((await getTripBlowout(ctx.db, ctx.shop.id, second.id))?.divers).toHaveLength(1);
  });

  it("answers for a departure that has left and still calls the rest", async () => {
    const ctx = await context([{ fullName: "Ada Storm", email: "ada.storm@example.com" }]);
    const gone = await sister(ctx, "Storm-Test Gone Boat", -3);
    const email = fakeEmail();
    const results = await callDayBlowout(ctx.db, {
      shopId: ctx.shop.id,
      tripIds: [gone.id, ctx.trip.id, ctx.trip.id],
      calledByPersonId: ctx.ownerId,
      provider: email.provider,
    });
    expect(results).toEqual([
      { tripId: gone.id, outcome: { ok: false, reason: "trip_departed" } },
      { tripId: ctx.trip.id, outcome: expect.objectContaining({ ok: true, sent: 1 }) },
    ]);
  });

  it("refuses a departure twenty minutes past its start, and leaves it scheduled", async () => {
    const ctx = await context();
    const late = await sister(ctx, "Storm-Test Late Boat", -20 / 60, "Cal Squall");
    const results = await callDayBlowout(ctx.db, {
      shopId: ctx.shop.id,
      tripIds: [late.id, ctx.trip.id],
      calledByPersonId: ctx.ownerId,
      provider: fakeEmail().provider,
    });
    expect(results[0]).toEqual({
      tripId: late.id,
      outcome: { ok: false, reason: "trip_departed" },
    });
    expect(results[1]?.outcome.ok).toBe(true);
    const [row] = await ctx.db
      .select({ status: tripsTable.status })
      .from(tripsTable)
      .where(eq(tripsTable.id, late.id));
    expect(row?.status).toBe("scheduled");
    // The single-trip call holds the same line.
    expect(
      await callTripBlowout(ctx.db, { ...callInput(ctx, fakeEmail().provider), tripId: late.id }),
    ).toEqual({ ok: false, reason: "trip_departed" });
  });

  it("refuses a departure whose roll call has begun, hours before it is due out", async () => {
    const ctx = await context([{ fullName: "Ada Storm", email: "ada.storm@example.com" }]);
    // Any roll-call event counts: the crew are at the boat, counting heads.
    const boarded = await recordRollCall(ctx.db, {
      shopId: ctx.shop.id,
      tripId: ctx.trip.id,
      bookingId: ctx.bookingIds[0] as string,
      recordedByPersonId: ctx.ownerId,
      status: "not_boarded",
    });
    expect(boarded.ok).toBe(true);
    const [result] = await callDayBlowout(ctx.db, {
      shopId: ctx.shop.id,
      tripIds: [ctx.trip.id],
      calledByPersonId: ctx.ownerId,
      provider: fakeEmail().provider,
    });
    expect(result?.outcome).toEqual({ ok: false, reason: "trip_departed" });
  });

  it("still finishes every departure it set up when another one's setup throws", async () => {
    const ctx = await context([{ fullName: "Ada Storm", email: "ada.storm@example.com" }]);
    const second = await sister(ctx, "Storm-Test Throwing Boat", 21, "Ben Gale");
    const third = await sister(ctx, "Storm-Test Third Boat", 22, "Cal Squall");
    // The second departure's setup transaction fails outright (a dropped
    // connection, a deadlock); nothing about the first or third may be stranded.
    let transactions = 0;
    const faulty = new Proxy(ctx.db, {
      get(target, prop) {
        if (prop === "transaction") {
          return (...args: Parameters<typeof target.transaction>) => {
            transactions += 1;
            if (transactions === 2) throw new Error("injected setup failure");
            return target.transaction(...args);
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const email = fakeEmail();
    const results = await callDayBlowout(faulty, {
      shopId: ctx.shop.id,
      tripIds: [ctx.trip.id, second.id, third.id],
      calledByPersonId: ctx.ownerId,
      provider: email.provider,
    });
    expect(results.map((row) => [row.tripId, row.outcome.ok])).toEqual([
      [ctx.trip.id, true],
      [second.id, false],
      [third.id, true],
    ]);
    expect(results[1]?.outcome).toEqual({ ok: false, reason: "failed" });
    // Both called departures sent their divers' messages; the failed one was
    // never cancelled, so nobody on it is stranded without one.
    expect(
      blowoutSends(email.sent)
        .map((send) => send.diverName)
        .sort(),
    ).toEqual(["Ada Storm", "Cal Squall"]);
    const [left] = await ctx.db
      .select({ status: tripsTable.status })
      .from(tripsTable)
      .where(eq(tripsTable.id, second.id));
    expect(left?.status).toBe("scheduled");
  });

  it("tells the crew of every departure it calls off, at once", async () => {
    const ctx = await context();
    // Far past the seeded schedule, so no seeded crew clash refuses the assignment.
    const far = await sister(ctx, "Storm-Test Crewed Boat", 24 * 400);
    const staff = await listStaff(ctx.db, ctx.shop.id);
    const crew = staff.find(
      (row) => row.person.id !== ctx.ownerId && row.roles.includes("divemaster"),
    )?.person;
    if (!crew) throw new Error("seeded divemaster missing");
    expect(
      await changeTripCrew(
        ctx.db,
        ctx.shop.id,
        far.id,
        { operation: "assign", personId: crew.id },
        { actorPersonId: ctx.ownerId },
      ),
    ).toBe(true);
    await callDayBlowout(ctx.db, {
      shopId: ctx.shop.id,
      tripIds: [far.id],
      calledByPersonId: ctx.ownerId,
      provider: fakeEmail().provider,
    });
    const rows = await ctx.db
      .select({ change: crewNotices.change, settledAt: crewNotices.settledAt })
      .from(crewNotices)
      .where(and(eq(crewNotices.tripId, far.id), eq(crewNotices.personId, crew.id)));
    const calledOff = rows.filter((row) => row.change === "called_off");
    expect(calledOff).toHaveLength(1);
    // Settled straight away — not left for the hourly pass.
    expect(calledOff[0]?.settledAt).not.toBeNull();
  });

  it("is the single-trip call, so calling a departure again resumes and re-sends nobody", async () => {
    const ctx = await context([{ fullName: "Ada Storm", email: "ada.storm@example.com" }]);
    const email = fakeEmail();
    await callTripBlowout(ctx.db, callInput(ctx, email.provider));
    const [again] = await callDayBlowout(ctx.db, {
      shopId: ctx.shop.id,
      tripIds: [ctx.trip.id],
      calledByPersonId: ctx.ownerId,
      provider: email.provider,
    });
    expect(again?.outcome).toMatchObject({ ok: true, resumed: true, sent: 0 });
    expect(blowoutSends(email.sent)).toHaveLength(1);
  });

  it("refuses another shop's departure inside the same call", async () => {
    const ctx = await context();
    const [result] = await callDayBlowout(ctx.db, {
      shopId: ctx.shop.id,
      tripIds: ["00000000-0000-4000-8000-000000000999"],
      calledByPersonId: ctx.ownerId,
      provider: fakeEmail().provider,
    });
    expect(result?.outcome).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("listDayBlowoutDepartures", () => {
  it("lists a day's departures in order, with who is booked and which were already called", async () => {
    const ctx = await context([
      { fullName: "Ada Storm", email: "ada.storm@example.com" },
      { fullName: "Ben Gale", email: "ben.gale@example.com" },
    ]);
    await callTripBlowout(ctx.db, callInput(ctx, fakeEmail().provider));
    const from = new Date(ctx.trip.startsAt.getTime() - HOUR);
    const to = new Date(ctx.trip.startsAt.getTime() + HOUR);
    const rows = await listDayBlowoutDepartures(ctx.db, ctx.shop.id, { from, to });
    const mine = rows.find((row) => row.id === ctx.trip.id);
    expect(mine).toMatchObject({ booked: 2, calledOff: true, status: "cancelled" });
    expect(mine?.rollCallStarted).toBe(false);
    // Every message settled, so there is nothing to resume.
    expect(mine?.unsent).toBe(0);
    expect(rows.every((row) => row.startsAt >= from && row.startsAt < to)).toBe(true);
  });

  it("says who is crewing each departure, and whether roll call has begun", async () => {
    const ctx = await context([{ fullName: "Ada Storm", email: "ada.storm@example.com" }]);
    const staff = await listStaff(ctx.db, ctx.shop.id);
    const crew = staff.find((row) => row.person.id !== ctx.ownerId)?.person;
    if (!crew) throw new Error("seeded crew missing");
    // Far past the seeded schedule, so no seeded crew clash refuses the assignment.
    const far = await createTrip(ctx.db, {
      shopId: ctx.shop.id,
      title: "Storm-Test Crewed Boat",
      startsAt: new Date(ctx.now.getTime() + 24 * 400 * HOUR),
      endsAt: new Date(ctx.now.getTime() + (24 * 400 + 2) * HOUR),
      capacity: 12,
    });
    if (!far) throw new Error("far trip could not be created");
    expect(
      await changeTripCrew(ctx.db, ctx.shop.id, far.id, { operation: "assign", personId: crew.id }),
    ).toBe(true);
    await recordRollCall(ctx.db, {
      shopId: ctx.shop.id,
      tripId: ctx.trip.id,
      bookingId: ctx.bookingIds[0] as string,
      recordedByPersonId: ctx.ownerId,
      status: "not_boarded",
    });
    const around = async (startsAt: Date) =>
      listDayBlowoutDepartures(ctx.db, ctx.shop.id, {
        from: new Date(startsAt.getTime() - HOUR),
        to: new Date(startsAt.getTime() + HOUR),
      });
    const crewed = (await around(far.startsAt)).find((row) => row.id === far.id);
    expect(crewed?.crew).toEqual([crew.fullName]);
    expect(crewed?.rollCallStarted).toBe(false);
    const counted = (await around(ctx.trip.startsAt)).find((row) => row.id === ctx.trip.id);
    expect(counted?.rollCallStarted).toBe(true);
  });
});
