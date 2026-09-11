// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowMs } from "@/lib/clock";
import type { CheckoutProvider } from "@/lib/payments/checkout";
import { seededShopContext } from "@/test/db";
import { fakeEmail } from "@/test/fakes";
import { issueBookingCapability } from "./booking-capabilities";
import { cancelBooking, createBooking, createGiftBooking } from "./bookings";
import { markCheckoutPaidBySessionId, startBookingCheckout } from "./checkouts";
import type { AppDb } from "./client";
import {
  giftCountsForWindow,
  giftForBooking,
  giftGiversByBooking,
  giverGiftView,
  sendGiftPassesForCheckout,
  sendPendingGiftPasses,
} from "./gifts";
import { getBookingPayment } from "./payments";
import { refundBookingOnShopCancellation } from "./refunds";
import { bookingGifts, bookings } from "./schema";
import { claimPartySeat } from "./seat-claims";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import { getTripRoster, setTripStatus, upcomingTripsWithCounts, updateTrip } from "./trips";

/**
 * **Give a dive** (ADR 20260908-one-hand, decision 6, lever W; owner's call
 * (l)).
 *
 * The whole design rests on one sentence — *a gift is a booking* — so what has
 * to be pinned here is that nothing about a gift is a second kind of thing:
 * the seat is taken and counted the moment it is paid for, capacity refuses the
 * thirteenth gift exactly as it refuses the thirteenth ordinary seat, the claim
 * is the party's own claim, and the refund reverses the capture the giver's own
 * card made.
 *
 * And one thing that is *not* like a booking: what the giver may read. That is
 * asserted by key, so widening `GiftGiverView` fails here rather than in review.
 */

const GIVER = {
  giverName: "Hannah Liu",
  giverEmail: "hannah.liu@example.com",
  receiverName: "Ben Carter",
  message: "From Hannah, for your birthday",
};

async function context() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const open = trips.find((t) => t.title === "Two-Tank Reef — Christ of the Abyss");
  const fullTrip = trips.find((t) => t.title === "Wreck Trip — Spiegel Grove");
  if (!open || !fullTrip) throw new Error("expected seeded trips missing");
  return { db, shop, open, fullTrip };
}

async function giveASeat(db: AppDb, shopId: string, tripId: string) {
  const outcome = await createGiftBooking(
    db,
    { actor: "public", shopId, tripId, fullName: GIVER.receiverName },
    GIVER,
  );
  if (!outcome.ok) throw new Error(`gift booking failed: ${outcome.reason}`);
  return outcome;
}

/**
 * A Stripe stand-in for the two tests that need a session to exist. Records
 * nothing: what those tests assert is which *seat* the session settled, not
 * what Stripe was asked.
 */
function giftCheckout(): CheckoutProvider {
  return {
    async createCheckoutSession(request) {
      return {
        status: "created",
        stripeSessionId: `cs_gift_${Math.random().toString(36).slice(2, 10)}`,
        stripeStatus: "open",
        paymentStatus: "unpaid",
        checkoutUrl: "https://checkout.stripe.com/c/pay/cs_gift",
        amountTotalCents: request.lineItems.reduce(
          (sum, line) => sum + line.unitAmountCents * line.quantity,
          0,
        ),
        taxAmountCents: null,
        stripeCustomerId: null,
        expiresAt: new Date(nowMs() + 24 * 60 * 60 * 1000),
      };
    },
    async retrieveCheckoutSession() {
      return { status: "failed" };
    },
    async refundCheckoutSession() {
      return { status: "refunded", refundId: "re_gift" };
    },
  };
}

describe("createGiftBooking", () => {
  it("takes a real seat, under the name the giver typed", async () => {
    const { db, shop, open } = await context();
    const before = (await upcomingTripsWithCounts(db, shop.id)).find((t) => t.id === open.id);
    const gift = await giveASeat(db, shop.id, open.id);

    const roster = await getTripRoster(db, shop.id, open.id);
    expect(roster.map((row) => row.person.fullName)).toContain("Ben Carter");
    const after = (await upcomingTripsWithCounts(db, shop.id)).find((t) => t.id === open.id);
    expect(after?.booked).toBe((before?.booked ?? 0) + 1);

    const record = await giftForBooking(db, shop.id, gift.bookingId);
    expect(record).toMatchObject({
      giverName: "Hannah Liu",
      giverEmail: "hannah.liu@example.com",
      receiverName: "Ben Carter",
      message: "From Hannah, for your birthday",
    });
  });

  /**
   * The capacity rule is the whole reason a gift is a booking rather than a
   * voucher: a shop that sold twelve seats and gave one away has thirteen
   * people at the dock, which is the failure the transaction exists to prevent.
   */
  it("is refused by capacity exactly as an ordinary seat is", async () => {
    const { db, shop, fullTrip } = await context();
    const outcome = await createGiftBooking(
      db,
      { actor: "public", shopId: shop.id, tripId: fullTrip.id, fullName: "Ben Carter" },
      GIVER,
    );
    expect(outcome).toEqual({ ok: false, reason: "trip_full" });
  });

  /**
   * A refused gift must leave nothing behind — not a seat, and not a gift row
   * pointing at a booking that never existed. Both halves are in one
   * transaction for exactly this.
   */
  it("writes no gift row when the booking is refused", async () => {
    const { db, shop, fullTrip } = await context();
    await createGiftBooking(
      db,
      { actor: "public", shopId: shop.id, tripId: fullTrip.id, fullName: "Ben Carter" },
      GIVER,
    );
    const rows = await db.select().from(bookingGifts).where(eq(bookingGifts.shopId, shop.id));
    expect(rows).toHaveLength(0);
  });

  it("leaves an ordinary booking with no gift on it", async () => {
    const { db, shop, open } = await context();
    const plain = await createBooking(db, {
      actor: "public",
      shopId: shop.id,
      tripId: open.id,
      fullName: "Nora Quinn",
      email: "nora@example.com",
    });
    if (!plain.ok) throw new Error("setup booking failed");
    expect(await giftForBooking(db, shop.id, plain.bookingId)).toBeNull();
  });

  it("is not readable from another shop", async () => {
    const { db, shop, open } = await context();
    const gift = await giveASeat(db, shop.id, open.id);
    const otherShopId = "00000000-0000-4000-8000-000000000000";
    expect(await giftForBooking(db, otherShopId, gift.bookingId)).toBeNull();
    expect(await giftGiversByBooking(db, otherShopId, [gift.bookingId])).toEqual(new Map());
  });
});

describe("claiming a gift seat", () => {
  /**
   * A gift has no party lead, so `claimableNow` would refuse it on the party
   * rule alone — the gift row is what makes the seat claimable, and this is the
   * assertion that keeps the two arms in step.
   */
  it("hands the seat to the receiver, with their own contact", async () => {
    const { db, shop, open } = await context();
    const gift = await giveASeat(db, shop.id, open.id);
    const claim = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId: gift.bookingId,
      purpose: "claim",
    });
    if (!claim) throw new Error("claim capability not issued");

    const outcome = await claimPartySeat(db, {
      token: claim.token,
      fullName: "Ben Carter",
      email: "ben@example.com",
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.bookingId).toBe(gift.bookingId);

    const [row] = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, gift.bookingId), eq(bookings.shopId, shop.id)));
    expect(row?.claimedAt).toBeTruthy();
    expect(row?.personId).toBe(outcome.personId);
  });

  it("cannot be claimed twice", async () => {
    const { db, shop, open } = await context();
    const gift = await giveASeat(db, shop.id, open.id);
    const claim = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId: gift.bookingId,
      purpose: "claim",
    });
    if (!claim) throw new Error("claim capability not issued");
    const first = await claimPartySeat(db, {
      token: claim.token,
      fullName: "Ben Carter",
      email: "ben@example.com",
    });
    expect(first.ok).toBe(true);
    // Claiming revokes every capability on the booking, so the same link is
    // dead — one seat, one claim.
    const second = await claimPartySeat(db, {
      token: claim.token,
      fullName: "Someone Else",
      email: "someone@example.com",
    });
    expect(second).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("giverGiftView", () => {
  /**
   * **The shape is the guard.** A giver reads four facts about somebody else's
   * day; every key here is one of them or the departure they already knew
   * about. A certification, a medical answer, an address, a phone number or a
   * diver's own person row appearing in this type is a defect, and this test is
   * where it is caught.
   */
  it("exposes the departure, the giver's own words, and four facts — nothing else", async () => {
    const { db, shop, open } = await context();
    const gift = await giveASeat(db, shop.id, open.id);
    const view = await giverGiftView(db, gift.bookingId);
    if (!view) throw new Error("gift view missing");

    expect(Object.keys(view).sort()).toEqual(
      [
        "aboard",
        "claimedAt",
        "contactEmail",
        "contactPhone",
        "courseId",
        "defaultLocale",
        "departureCancelled",
        "diveSiteId",
        "endsAt",
        "giverName",
        "message",
        "payment",
        "receiverName",
        "shopId",
        "shopName",
        "shopSlug",
        "startsAt",
        "timezone",
        "tripId",
        "tripTitle",
        "waiverSignedAt",
      ].sort(),
    );
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("certification");
    expect(serialized).not.toContain("medical");
  });

  it("starts unclaimed, unsigned and not aboard", async () => {
    const { db, shop, open } = await context();
    const gift = await giveASeat(db, shop.id, open.id);
    const view = await giverGiftView(db, gift.bookingId);
    expect(view).toMatchObject({
      claimedAt: null,
      waiverSignedAt: null,
      aboard: false,
      departureCancelled: false,
      receiverName: "Ben Carter",
      giverName: "Hannah Liu",
    });
  });

  /**
   * **The receiver's own name never reaches the giver.** After a claim the
   * booking's person row is the claimant's real record; the page keeps reading
   * `receiver_name`, which is what the giver themselves typed.
   */
  it("keeps showing the giver's own words after the seat is claimed", async () => {
    const { db, shop, open } = await context();
    const gift = await giveASeat(db, shop.id, open.id);
    const claim = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId: gift.bookingId,
      purpose: "claim",
    });
    if (!claim) throw new Error("claim capability not issued");
    await claimPartySeat(db, {
      token: claim.token,
      fullName: "Benedict Carter-Okonkwo",
      email: "ben@example.com",
    });

    const view = await giverGiftView(db, gift.bookingId);
    expect(view?.receiverName).toBe("Ben Carter");
    expect(view?.claimedAt).toBeTruthy();
    expect(JSON.stringify(view)).not.toContain("Benedict");
    expect(JSON.stringify(view)).not.toContain("ben@example.com");
  });

  /**
   * **A seat that is no longer on the boat is not a gift to read** (security
   * review of this slice, finding 4). The token lives a season, so without this
   * a cancelled seat kept rendering "not claimed yet · not aboard yet" for six
   * months — and after the receiver's erasure the redaction showed through as
   * `erased-…` on a page nobody could explain.
   */
  it("answers nothing once the seat is cancelled", async () => {
    const { db, shop, open } = await context();
    const gift = await giveASeat(db, shop.id, open.id);
    expect(await giverGiftView(db, gift.bookingId)).toBeTruthy();
    await cancelBooking(db, shop.id, gift.bookingId);
    expect(await giverGiftView(db, gift.bookingId)).toBeNull();
  });

  it("answers nothing for a booking that is not a gift", async () => {
    const { db, shop, open } = await context();
    const plain = await createBooking(db, {
      actor: "public",
      shopId: shop.id,
      tripId: open.id,
      fullName: "Nora Quinn",
      email: "nora@example.com",
    });
    if (!plain.ok) throw new Error("setup booking failed");
    expect(await giverGiftView(db, plain.bookingId)).toBeNull();
  });

  it("says the departure was called off", async () => {
    const { db, shop, open } = await context();
    const gift = await giveASeat(db, shop.id, open.id);
    await setTripStatus(db, shop.id, open.id, "cancelled");
    expect((await giverGiftView(db, gift.bookingId))?.departureCancelled).toBe(true);
  });
});

/**
 * **The money goes back where it came from.**
 *
 * The giver's card is the one charged, because the giver's address is what the
 * checkout was started with — and `refundBookingOnShopCancellation` reverses
 * *that capture*, by its session id, rather than paying anybody by name. So
 * "the refund goes to the payer" is a property of which session was refunded,
 * and that is what this asserts.
 */
describe("a blown-out gift", () => {
  it("reverses the giver's own checkout session", async () => {
    const { db, shop, open } = await context();
    // A priced departure and a connected account: without both there is no
    // checkout to start and therefore no capture to reverse.
    await updateTrip(db, shop.id, open.id, {
      title: open.title,
      startsAt: open.startsAt,
      endsAt: open.endsAt,
      capacity: open.capacity,
      plannedDives: open.plannedDives,
      priceCents: 9_500,
    });
    const gift = await giveASeat(db, shop.id, open.id);
    await upsertShopStripeAccount(db, shop.id, "acct_gift");
    await setShopStripeAccountStatus(db, "acct_gift", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });

    const refundCalls: { sessionId: string }[] = [];
    const checkout: CheckoutProvider = {
      async createCheckoutSession(request) {
        return {
          status: "created",
          stripeSessionId: "cs_gift",
          stripeStatus: "open",
          paymentStatus: "unpaid",
          checkoutUrl: "https://checkout.stripe.com/c/pay/cs_gift",
          amountTotalCents: request.lineItems.reduce(
            (sum, line) => sum + line.unitAmountCents * line.quantity,
            0,
          ),
          taxAmountCents: null,
          stripeCustomerId: null,
          expiresAt: new Date(nowMs() + 24 * 60 * 60 * 1000),
        };
      },
      async retrieveCheckoutSession() {
        return { status: "failed" };
      },
      async refundCheckoutSession(_accountId, stripeSessionId) {
        refundCalls.push({ sessionId: stripeSessionId });
        return { status: "refunded", refundId: "re_gift" };
      },
    };

    const start = await startBookingCheckout(
      db,
      {
        shopId: shop.id,
        tripId: open.id,
        bookingIds: [gift.bookingId],
        // The giver's address, which is the whole point: this is whose card
        // Stripe charges and therefore whose card the reversal lands on.
        customerEmail: GIVER.giverEmail,
        successUrl: "https://diveday.example/gift",
        cancelUrl: "https://diveday.example/gift?pay=cancelled",
        describeLine: ({ tripTitle }) => tripTitle,
      },
      checkout,
    );
    if (!start.ok) throw new Error(`checkout start failed: ${start.reason}`);
    expect(start.checkout.customerEmail).toBe(GIVER.giverEmail);
    await markCheckoutPaidBySessionId(db, start.checkout.stripeSessionId);

    await setTripStatus(db, shop.id, open.id, "cancelled");
    const outcome = await refundBookingOnShopCancellation(
      db,
      { shopId: shop.id, bookingId: gift.bookingId },
      checkout,
    );
    expect(outcome.status).toBe("refunded");
    // The session the giver paid on, and no other.
    expect(refundCalls).toEqual([{ sessionId: start.checkout.stripeSessionId }]);
    expect((await getBookingPayment(db, shop.id, gift.bookingId))?.status).toBe("refunded");
  });
});

/**
 * **The pass is sent once, to the giver, and never before it should be**
 * (security review of this slice, finding 1).
 *
 * The action's own half of this — that a priced departure's pass waits for the
 * checkout and an unpriced one goes immediately — is pinned in
 * `src/app/s/[shopSlug]/trips/[id]/actions.test.ts`. What is pinned here is the
 * sender: who it writes to, what it refuses to carry, and that a replayed
 * webhook cannot make it send twice.
 */
describe("sendPendingGiftPasses", () => {
  it("sends one pass per seat and never a second, however often it is called", async () => {
    const { db, shop, open } = await context();
    const gift = await giveASeat(db, shop.id, open.id);

    const first = fakeEmail();
    await sendPendingGiftPasses(
      db,
      { shopId: shop.id, bookingIds: [gift.bookingId] },
      first.provider,
    );
    expect(first.sent).toHaveLength(1);
    expect(first.sent[0]).toMatchObject({ kind: "gift_pass", to: GIVER.giverEmail });

    // **The giver's own line is not in the mail** (finding 1b): free text from
    // an unauthenticated form does not travel where a quarantine digest or a
    // shared inbox reads it. It renders on the claim page instead.
    expect(JSON.stringify(first.sent[0])).not.toContain("birthday");

    // A replayed webhook, a resumed cascade, a double-tapped return: the
    // delivery row is the dedup, so all three converge on the one send.
    const replay = fakeEmail();
    await sendPendingGiftPasses(
      db,
      { shopId: shop.id, bookingIds: [gift.bookingId] },
      replay.provider,
    );
    expect(replay.sent).toHaveLength(0);
  });

  it("sends nothing for a cancelled seat", async () => {
    const { db, shop, open } = await context();
    const gift = await giveASeat(db, shop.id, open.id);
    await cancelBooking(db, shop.id, gift.bookingId);
    const mail = fakeEmail();
    await sendPendingGiftPasses(
      db,
      { shopId: shop.id, bookingIds: [gift.bookingId] },
      mail.provider,
    );
    expect(mail.sent).toHaveLength(0);
  });

  it("sends nothing for another shop's booking", async () => {
    const { db, shop, open } = await context();
    const gift = await giveASeat(db, shop.id, open.id);
    const mail = fakeEmail();
    await sendPendingGiftPasses(
      db,
      { shopId: "00000000-0000-4000-8000-000000000000", bookingIds: [gift.bookingId] },
      mail.provider,
    );
    expect(mail.sent).toHaveLength(0);
  });

  it("sends nothing for a booking that is not a gift", async () => {
    const { db, shop, open } = await context();
    const plain = await createBooking(db, {
      actor: "public",
      shopId: shop.id,
      tripId: open.id,
      fullName: "Nora Quinn",
      email: "nora@example.com",
    });
    if (!plain.ok) throw new Error("setup booking failed");
    const mail = fakeEmail();
    await sendPendingGiftPasses(
      db,
      { shopId: shop.id, bookingIds: [plain.bookingId] },
      mail.provider,
    );
    expect(mail.sent).toHaveLength(0);
  });
  /**
   * The webhook's own door: it holds a settled checkout and nothing else, and
   * one checkout can cover several seats. This is the half that proves a paid
   * session finds its gift.
   */
  it("finds the gift seats a settled checkout covered", async () => {
    const { db, shop, open } = await context();
    await updateTrip(db, shop.id, open.id, {
      title: open.title,
      startsAt: open.startsAt,
      endsAt: open.endsAt,
      capacity: open.capacity,
      plannedDives: open.plannedDives,
      priceCents: 9_500,
    });
    await upsertShopStripeAccount(db, shop.id, "acct_gift_pass");
    await setShopStripeAccountStatus(db, "acct_gift_pass", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    const gift = await giveASeat(db, shop.id, open.id);

    const started = await startBookingCheckout(
      db,
      {
        shopId: shop.id,
        tripId: open.id,
        bookingIds: [gift.bookingId],
        customerEmail: GIVER.giverEmail,
        successUrl: "https://diveday.example/gift",
        cancelUrl: "https://diveday.example/gift?pay=cancelled",
        describeLine: ({ tripTitle }) => tripTitle,
      },
      giftCheckout(),
    );
    if (!started.ok) throw new Error(`checkout start failed: ${started.reason}`);
    await markCheckoutPaidBySessionId(db, started.checkout.stripeSessionId);

    const mail = fakeEmail();
    await sendGiftPassesForCheckout(
      db,
      { id: started.checkout.id, shopId: shop.id },
      mail.provider,
    );
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ kind: "gift_pass", to: GIVER.giverEmail });
  });
});

describe("giftCountsForWindow", () => {
  it("counts gifts on this month's departures, and how many are claimed", async () => {
    const { db, shop, open } = await context();
    const gift = await giveASeat(db, shop.id, open.id);
    const from = new Date(open.startsAt.getTime() - 24 * 60 * 60 * 1000);
    const to = new Date(open.startsAt.getTime() + 24 * 60 * 60 * 1000);

    expect(await giftCountsForWindow(db, shop.id, from, to)).toEqual({ given: 1, claimed: 0 });

    const claim = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId: gift.bookingId,
      purpose: "claim",
    });
    if (!claim) throw new Error("claim capability not issued");
    await claimPartySeat(db, {
      token: claim.token,
      fullName: "Ben Carter",
      email: "ben@example.com",
    });
    expect(await giftCountsForWindow(db, shop.id, from, to)).toEqual({ given: 1, claimed: 1 });
  });

  it("counts nothing outside the window, and nothing for another shop", async () => {
    const { db, shop, open } = await context();
    await giveASeat(db, shop.id, open.id);
    const long_ago_from = new Date(open.startsAt.getTime() - 400 * 24 * 60 * 60 * 1000);
    const long_ago_to = new Date(open.startsAt.getTime() - 300 * 24 * 60 * 60 * 1000);
    expect(await giftCountsForWindow(db, shop.id, long_ago_from, long_ago_to)).toEqual({
      given: 0,
      claimed: 0,
    });
    const from = new Date(open.startsAt.getTime() - 24 * 60 * 60 * 1000);
    const to = new Date(open.startsAt.getTime() + 24 * 60 * 60 * 1000);
    expect(await giftCountsForWindow(db, "00000000-0000-4000-8000-000000000000", from, to)).toEqual(
      { given: 0, claimed: 0 },
    );
  });
});
