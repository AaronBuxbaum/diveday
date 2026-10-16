import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate, nowMs } from "@/lib/clock";
import type { TodayAction } from "@/lib/today";
import { dbNowPlus, fileScopedShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import { markInboundAnswered, recordInboundMessage } from "./inbound-messages";
import { queueMediaDeletion, resolveMediaDeletion } from "./media-deletions";
import { recordStripeDispute } from "./payment-disputes";
import { startPaymentOperation } from "./payment-operations";
import { setBookingPayment } from "./payments";
import { submitTripReview } from "./reviews";
import { inboundMessages, orders, people, tripReviews } from "./schema";
import { applyStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import { getTodayWork } from "./today";
import { rowsContext } from "./today-rows-test-fixtures";
import { pushShopRows } from "./today-shop-rows";
import { getTripRoster, setTripStatus, upcomingTripsWithCounts } from "./trips";

const quiet = {
  opsAlerts: null,
  reviewsAwaiting: { count: 0, onlyId: null },
  unanswered: 0,
  openOrders: new Map(),
};

function rows(wave: Record<string, unknown>): TodayAction[] {
  const actions: TodayAction[] = [];
  pushShopRows(actions, rowsContext({ ...quiet, ...wave }));
  return actions;
}

describe("pushShopRows", () => {
  it("adds nothing for a shop with nothing waiting", () => {
    expect(rows({})).toEqual([]);
  });

  it("sends one review straight to its own anchor, and several to the list", () => {
    const [one] = rows({ reviewsAwaiting: { count: 1, onlyId: "r1" } });
    expect(one).toMatchObject({ kind: "reviews_pending", urgency: "later", dueAt: null });
    expect(one?.href).toBe("/shop/blue-mantis/reviews#review-r1");
    const [several] = rows({ reviewsAwaiting: { count: 3, onlyId: null } });
    expect(several?.href).toBe("/shop/blue-mantis/reviews");
  });

  it("raises one inbox row however many divers wrote back", () => {
    const inbox = rows({ unanswered: 4 });
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({
      kind: "unanswered_messages",
      href: "/shop/blue-mantis/inbox",
    });
  });
});

/** One database for the file, one transaction per test (`fileScopedShopContext`, src/test/db.ts). */
const ctx = fileScopedShopContext();

describe("ops alerts on the queue (task 157)", () => {
  it("surfaces a stuck payment operation as an urgency: now row, only when the caller opts in", async () => {
    const { db, shop } = ctx;
    const intent = await startPaymentOperation(db, { shopId: shop.id, kind: "invoice" });
    // No wall-clock trickery needed on the write side: reading the queue from
    // ten minutes in the *database's* future is what makes the just-started
    // intent read as stuck (same trick `listStuckPaymentOperations`' own
    // tests use; `started_at` is a `defaultNow()` column, so Postgres' clock
    // is the one that has to move — see `dbNow` in src/test/db.ts).
    const future = await dbNowPlus(db, 10 * 60 * 1000);
    const t = staffTranslator("en-US");

    const withoutFlag = await getTodayWork(
      db,
      shop.id,
      shop.slug,
      shop.timezone,
      future,
      undefined,
      t,
      "en-US",
    );
    expect(
      withoutFlag.actions.find((a) => a.id === `stuck-payment-op:${intent.id}`),
    ).toBeUndefined();

    const withFlag = await getTodayWork(
      db,
      shop.id,
      shop.slug,
      shop.timezone,
      future,
      undefined,
      t,
      "en-US",
      true,
    );
    const row = withFlag.actions.find((a) => a.id === `stuck-payment-op:${intent.id}`);
    expect(row).toBeDefined();
    expect(row?.kind).toBe("stuck_payment_operation");
    // Forced "now" regardless of any departure — there isn't one — but still
    // undated, so it never jumps ahead of a real diver blocker within that band.
    expect(row?.urgency).toBe("now");
    expect(row?.dueAt).toBeNull();
    // Orders, not Reports: an intent with no trip on it can only be
    // reconciled from the panel that carries its Stripe id, and that panel
    // moved to the Orders index when the monthly report became only a report.
    expect(row?.href).toBe(`/shop/${shop.slug}/orders`);
  });

  it("surfaces a failed photo-deletion retry as an urgency: now row, only when the caller opts in", async () => {
    const { db, shop } = ctx;
    const attempt = await queueMediaDeletion(db, {
      shopId: shop.id,
      kind: "recap_photo",
      url: "https://diveday-media.s3.us-east-1.amazonaws.com/example/photo.jpg",
    });
    if (!attempt) throw new Error("expected a managed blob URL to queue");
    await resolveMediaDeletion(db, attempt.id, { status: "failed", error: "network error" });
    const t = staffTranslator("en-US");

    const withoutFlag = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(
      withoutFlag.actions.find((a) => a.id === `media-deletion:${attempt.id}`),
    ).toBeUndefined();

    const withFlag = await getTodayWork(
      db,
      shop.id,
      shop.slug,
      shop.timezone,
      undefined,
      undefined,
      t,
      "en-US",
      true,
    );
    const row = withFlag.actions.find((a) => a.id === `media-deletion:${attempt.id}`);
    expect(row).toBeDefined();
    expect(row?.kind).toBe("failed_photo_deletion");
    expect(row?.urgency).toBe("now");
    expect(row?.dueAt).toBeNull();
    // The retry button for a stuck deletion lives in Settings' "Data &
    // integrations" group now, so the row lands on that group's anchor.
    expect(row?.href).toBe(`/shop/${shop.slug}/settings#data`);
  });

  it("mirrors money owed for a canceled departure, once it has sat for a day", async () => {
    // The panel on the Orders index owns this queue; Today mirrors it, the
    // same arrangement the two rows above use
    // (ADR 20260813-shop-cancellation-refunds-itself).
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const [seat] = await getTripRoster(db, shop.id, reef.id);
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId: seat.booking.id,
      status: "paid",
      currency: "usd",
      amountCents: 18_000,
    });
    await setTripStatus(db, shop.id, reef.id, "cancelled");
    const t = staffTranslator("en-US");
    // By kind, not by `owed-refund:<booking>`: a cancelled departure that
    // owes more than one seat collapses to a single `owed-refunds:<trip>`
    // row (`collapseOwedRefunds`), and which of the two this fixture
    // produces depends on how many seats the seeded boat had paid for.
    const owedRow = (work: Awaited<ReturnType<typeof getTodayWork>>) =>
      work.actions.find((a) => a.kind === "owed_refund");

    // Money that only just changed hands is on the panel but not yet in the
    // queue — Today waits a day so a seat settled minutes before the sweep
    // does not arrive in the same breath it was taken.
    const sameDay = await getTodayWork(
      db,
      shop.id,
      shop.slug,
      shop.timezone,
      undefined,
      undefined,
      t,
      "en-US",
      true,
    );
    expect(owedRow(sameDay)).toBeUndefined();

    // A day later it is in the queue.
    const tomorrow = new Date(nowMs() + 25 * 60 * 60 * 1000);
    const withFlag = await getTodayWork(
      db,
      shop.id,
      shop.slug,
      shop.timezone,
      tomorrow,
      undefined,
      t,
      "en-US",
      true,
    );
    const row = owedRow(withFlag);
    expect(row).toBeDefined();
    expect(row?.urgency).toBe("now");
    expect(row?.dueAt).toBeNull();
    // The person waiting is named either way — this is the one
    // platform-health row with somebody on the other end of it. A lone owed
    // seat makes them the subject; a departure owing several names all of
    // them in the sentence.
    expect(`${row?.subject} ${row?.detail}`).toContain(seat.person.fullName);
    // The Guests tab is both where the seat is and where staff mark it
    // refunded once the cash is back in a hand.
    expect(row?.href).toBe(`/shop/${shop.slug}/trips/${reef.id}`);

    // And it is opt-in like every other ops alert.
    const withoutFlag = await getTodayWork(db, shop.id, shop.slug, shop.timezone, tomorrow);
    expect(owedRow(withoutFlag)).toBeUndefined();
  });

  it("shows an undecided card dispute with its amount and deadline, and clears it once decided", async () => {
    // ADR 20261009-stripe-reversals-reach-diveday.
    const { db, shop } = ctx;
    const [customer] = await db.select().from(people).where(eq(people.shopId, shop.id)).limit(1);
    if (!customer) throw new Error("seeded person missing");
    const [order] = await db
      .insert(orders)
      .values({
        shopId: shop.id,
        personId: customer.id,
        createdByPersonId: customer.id,
        status: "paid",
        currency: "usd",
        totalCents: 24_000,
        amountPaidCents: 24_000,
        stripeAccountId: "acct_today_dispute",
        stripeCustomerId: "cus_today",
        stripeInvoiceId: "in_today_dispute",
        stripePaymentIntentId: "pi_today_dispute",
      })
      .returning();
    if (!order) throw new Error("order insert failed");
    const opened = nowDate();
    const dispute = (eventType: string, status: string, occurredAt: Date) =>
      recordStripeDispute(db, {
        stripeAccountId: "acct_today_dispute",
        eventType,
        occurredAt,
        dispute: {
          id: "dp_today",
          paymentIntentId: "pi_today_dispute",
          amountCents: 24_000,
          currency: "usd",
          reason: "fraudulent",
          status,
          evidenceDueBy: new Date(Date.UTC(2031, 0, 15, 23, 59)),
          createdAt: opened,
        },
      });
    expect((await dispute("charge.dispute.created", "needs_response", opened)).status).toBe(
      "recorded",
    );
    const t = staffTranslator("en-US");
    const work = () =>
      getTodayWork(db, shop.id, shop.slug, shop.timezone, undefined, undefined, t, "en-US", true);

    const row = (await work()).actions.find((a) => a.kind === "payment_dispute");
    expect(row?.subject).toBe(customer.fullName);
    expect(row?.detail).toContain("$240.00");
    expect(row?.detail).toContain("Jan");
    expect(row?.urgency).toBe("now");
    expect(row?.href).toBe(`/shop/${shop.slug}/orders/${order.id}`);

    await dispute("charge.dispute.closed", "won", new Date(opened.getTime() + 60_000));
    expect((await work()).actions.find((a) => a.kind === "payment_dispute")).toBeUndefined();
  });

  it("tells owners and managers that Stripe turned card payments off, until it turns them on", async () => {
    const { db, shop } = ctx;
    await upsertShopStripeAccount(db, shop.id, "acct_today_restricted");
    const flags = { payoutsEnabled: true, detailsSubmitted: true };
    await applyStripeAccountStatus(db, "acct_today_restricted", { ...flags, chargesEnabled: true });
    const t = staffTranslator("en-US");
    const work = () =>
      getTodayWork(db, shop.id, shop.slug, shop.timezone, undefined, undefined, t, "en-US", true);
    expect((await work()).actions.find((a) => a.kind === "payments_restricted")).toBeUndefined();

    await applyStripeAccountStatus(db, "acct_today_restricted", {
      ...flags,
      chargesEnabled: false,
    });
    const row = (await work()).actions.find((a) => a.kind === "payments_restricted");
    expect(row).toMatchObject({
      subject: "Card payments are off",
      urgency: "now",
      href: `/shop/${shop.slug}/settings#money`,
    });
    expect(row?.detail).toContain("Divers pay at the shop");

    await applyStripeAccountStatus(db, "acct_today_restricted", { ...flags, chargesEnabled: true });
    expect((await work()).actions.find((a) => a.kind === "payments_restricted")).toBeUndefined();
  });

  it("is tenant-safe: another shop's queue never surfaces this shop's ops alerts", async () => {
    const { db, shop } = ctx;
    const intent = await startPaymentOperation(db, { shopId: shop.id, kind: "invoice" });
    const future = await dbNowPlus(db, 10 * 60 * 1000);

    const otherShopId = "00000000-0000-4000-8000-000000000000";
    const otherWork = await getTodayWork(
      db,
      otherShopId,
      "other-shop",
      shop.timezone,
      future,
      undefined,
      staffTranslator("en-US"),
      "en-US",
      true,
    );
    expect(otherWork.actions.find((a) => a.id === `stuck-payment-op:${intent.id}`)).toBeUndefined();
  });
});

describe("reviews waiting on moderation (one row, and where it lands)", () => {
  /**
   * Seats `names` on the demo reef trip and leaves each of them a review
   * carrying words — words are what holds a review for staff to read
   * (`submitTripReview`), so this is the queue row's own premise.
   */
  async function shopWithReviewsWaiting(names: readonly string[]) {
    const { db, shop } = ctx;
    const reviewIds: string[] = [];
    if (names.length === 0) return { db, shop, reviewIds };
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find(
      (trip) =>
        trip.title.startsWith("Two-Tank Reef — Molasses") &&
        trip.capacity - trip.booked >= names.length,
    );
    if (!reef) throw new Error("demo reef trip missing");
    const party = await createBookingParty(
      db,
      names.map((fullName, index) => ({
        actor: "staff" as const,
        shopId: shop.id,
        tripId: reef.id,
        fullName,
        email: `today-review-${index}@example.com`,
      })),
    );
    if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
    for (const [index, seat] of party.bookings.entries()) {
      const result = await submitTripReview(db, {
        bookingId: seat.bookingId,
        rating: 5,
        comment: `Superb dive ${index + 1}`,
      });
      if (!result.ok) throw new Error(`review refused: ${result.reason}`);
      if (result.published) throw new Error("expected a review held for moderation");
      const [row] = await db
        .select({ id: tripReviews.id })
        .from(tripReviews)
        .where(eq(tripReviews.bookingId, seat.bookingId));
      if (!row) throw new Error("review row missing");
      reviewIds.push(row.id);
    }
    return { db, shop, reviewIds };
  }

  it("emits no row at all when nothing is waiting", async () => {
    const { db, shop } = await shopWithReviewsWaiting([]);

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);

    expect(work.actions.some((action) => action.id === "reviews:pending")).toBe(false);
  });

  it("lands on the one waiting review's own anchor when it is the only one", async () => {
    const { db, shop, reviewIds } = await shopWithReviewsWaiting(["Reviewing Diver"]);

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const rows = work.actions.filter((action) => action.id === "reviews:pending");

    // Still one row — the destination sharpens, the queue never grows.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "reviews_pending",
      urgency: "later",
      dueAt: null,
      // `review-<id>` is the reviews list's own row anchor, the same fragment a
      // refused hide already redirects back to.
      href: `/shop/${shop.slug}/reviews#review-${reviewIds[0]}`,
    });
  });

  it("keeps the bare index once there is no single review to mean", async () => {
    const { db, shop } = await shopWithReviewsWaiting(["First Diver", "Second Diver"]);

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const rows = work.actions.filter((action) => action.id === "reviews:pending");

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "reviews_pending",
      urgency: "later",
      dueAt: null,
      href: `/shop/${shop.slug}/reviews`,
    });
  });
});

/**
 * The inbox's one row (ADR 20260907-two-way-inbox): what nobody has answered
 * yet, counted once for the whole shop and pointing at the page that empties
 * it. The demo seed leaves three messages unanswered
 * (`src/db/seed-inbox.ts`), which is what this counts.
 */
describe("unanswered messages", () => {
  const ctx = fileScopedShopContext();

  async function unansweredRow() {
    const { db, shop } = ctx;
    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    return work.actions.filter((action) => action.id === "inbox:unanswered");
  }

  it("counts what the shop has not answered and points at the inbox", async () => {
    const { shop } = ctx;
    const rows = await unansweredRow();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "unanswered_messages",
      urgency: "later",
      dueAt: null,
      href: `/shop/${shop.slug}/inbox`,
    });
    expect(rows[0]?.subject).toBe("3 messages are waiting on an answer.");
  });

  it("grows by one message and renders nothing once every one is answered", async () => {
    const { db, shop } = ctx;
    const recorded = await recordInboundMessage(db, {
      senderAuthenticated: true,
      shopId: shop.id,
      channel: "email",
      fromAddress: "someone.new@example.net",
      body: "Do you run night dives?",
      receivedAt: nowDate(),
      providerMessageId: "today-inbox-1",
    });
    if (recorded.status !== "recorded") throw new Error("message not recorded");
    expect((await unansweredRow())[0]?.subject).toBe("4 messages are waiting on an answer.");

    const live = await db
      .select({ id: inboundMessages.id })
      .from(inboundMessages)
      .where(and(eq(inboundMessages.shopId, shop.id), isNull(inboundMessages.deletedAt)));
    for (const row of live) await markInboundAnswered(db, shop.id, row.id);

    // Nothing waiting, no row — the queue never carries a zero.
    expect(await unansweredRow()).toHaveLength(0);
  });
});
