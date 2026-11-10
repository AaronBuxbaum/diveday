// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { PAYMENT_CLAIM_STALE_AFTER_MS } from "@/lib/attempts";
import { nowDate } from "@/lib/clock";
import { advanceClock } from "@/test/clock";
import { fileScopedShopContext } from "@/test/db";
import { recordingCheckout } from "@/test/fakes";
import { claimPartySeat, issuePartySeatClaims } from "../features/seat-claims/store";
import {
  issueBookingCapability,
  resolveExpiredGroupHoldOrganizer,
  revokeBookingCapabilities,
  verifyBookingCapability,
} from "./booking-capabilities";
import { addPartySeat, createBooking, createBookingParty, expireGroupHolds } from "./bookings";
import { startBookingCheckout } from "./checkouts";
import { setBookingPayment } from "./payments";
import { bookings, paymentOperationIntents, shops } from "./schema";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import { createTrip, getTripWithBooked } from "./trips";

const ctx = fileScopedShopContext();
const HOUR = 3_600_000;

async function heldParty() {
  const { db, shop } = ctx;
  const now = nowDate();
  const trip = await createTrip(db, {
    shopId: shop.id,
    title: "Group hold departure",
    capacity: 3,
    plannedDives: 1,
    startsAt: new Date(now.getTime() + 72 * HOUR),
    endsAt: new Date(now.getTime() + 76 * HOUR),
    priceCents: 10_000,
  });
  if (!trip) throw new Error("departure missing");
  const until = new Date(now.getTime() + 24 * HOUR);
  const outcome = await createBookingParty(
    db,
    [
      {
        actor: "public",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Group Organizer",
        email: "hold-organizer@example.com",
      },
      { actor: "public", shopId: shop.id, tripId: trip.id, fullName: "Group Companion" },
    ],
    { holdUntil: until },
  );
  if (!outcome.ok || !outcome.bookings[0] || !outcome.bookings[1]) throw new Error("party missing");
  return { db, shop, trip, until, lead: outcome.bookings[0], member: outcome.bookings[1] };
}

async function tripSeats() {
  const { db, shop } = ctx;
  return db.select().from(bookings).where(eq(bookings.shopId, shop.id));
}

describe("expiring party holds", () => {
  it("holds a public party until its explicit deadline inside the booking transaction", async () => {
    const { db, shop, trip, until } = await heldParty();
    const seats = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.shopId, shop.id), eq(bookings.tripId, trip.id)));
    expect(seats).toHaveLength(2);
    expect(seats.map((seat) => seat.groupHoldUntil)).toEqual([until, until]);
    expect(await expireGroupHolds(db, new Date(until.getTime() - 1))).toBe(0);
    expect((await getTripWithBooked(db, shop.id, trip.id))?.booked).toBe(2);
  });

  it("expires unpaid seats exactly at the deadline, revokes their links, and leaves an organizer ledger row", async () => {
    const { db, shop, trip, until, lead, member } = await heldParty();
    const link = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId: member.bookingId,
      purpose: "claim",
    });
    expect(link).not.toBeNull();
    expect(await expireGroupHolds(db, until)).toBe(2);
    expect(await expireGroupHolds(db, until)).toBe(0);
    expect((await getTripWithBooked(db, shop.id, trip.id))?.booked).toBe(0);
    expect((await tripSeats()).filter((seat) => seat.tripId === trip.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: member.bookingId,
          status: "cancelled",
          groupHoldUntil: null,
          groupHoldExpiredAt: until,
        }),
      ]),
    );
    if (!link) throw new Error("claim link missing");
    expect(
      await verifyBookingCapability(db, { token: link.token, purpose: "claim", now: until }),
    ).toBeNull();
    const ledger = await issuePartySeatClaims(db, {
      shopId: shop.id,
      leadBookingId: lead.bookingId,
      now: until,
    });
    expect(ledger).toEqual([
      expect.objectContaining({
        bookingId: member.bookingId,
        groupHoldExpired: true,
        seatHeld: false,
        payable: false,
        claim: null,
      }),
    ]);
  });

  it.each(["paid", "deposit_paid", "partly_refunded", "waived"] as const)(
    "keeps a %s seat while releasing the unpaid companion",
    async (status) => {
      const { db, shop, until, lead, member } = await heldParty();
      await setBookingPayment(db, {
        shopId: shop.id,
        bookingId: lead.bookingId,
        status,
        currency: "usd",
        amountCents: 5_000,
      });
      expect(await expireGroupHolds(db, until)).toBe(1);
      const seats = await tripSeats();
      expect(seats.find((seat) => seat.id === lead.bookingId)).toMatchObject({
        status: "booked",
        groupHoldUntil: null,
        groupHoldExpiredAt: null,
      });
      expect(seats.find((seat) => seat.id === member.bookingId)).toMatchObject({
        status: "cancelled",
      });
    },
  );

  it("releases due holds before a new capacity decision without waiting for cron", async () => {
    const { db, shop, trip, until } = await heldParty();
    advanceClock(until.getTime() - nowDate().getTime());
    for (let index = 0; index < 3; index++) {
      expect(
        await createBooking(db, {
          actor: "staff",
          shopId: shop.id,
          tripId: trip.id,
          fullName: `Replacement ${index}`,
        }),
      ).toMatchObject({ ok: true });
    }
    expect(
      await createBooking(db, {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "No fourth seat",
      }),
    ).toEqual({ ok: false, reason: "trip_full" });
    expect((await getTripWithBooked(db, shop.id, trip.id))?.booked).toBe(3);
  });

  it("does not release a seat while its provider call is in flight", async () => {
    const { db, shop, until, member } = await heldParty();
    // A recent non-null claim is fenced by payment reconciliation.
    advanceClock(until.getTime() - nowDate().getTime());
    const { startPaymentOperation } = await import("./payment-operations");
    const intent = await startPaymentOperation(db, {
      shopId: shop.id,
      bookingId: member.bookingId,
      kind: "checkout_session",
    });
    await db
      .update(bookings)
      .set({ pendingCheckoutIntentId: intent.id })
      .where(eq(bookings.id, member.bookingId));
    expect(await expireGroupHolds(db, until)).toBe(1);
    expect((await tripSeats()).find((seat) => seat.id === member.bookingId)?.status).toBe("booked");
  });

  it("keeps only a narrow read-only organizer door after its unpaid seat expires", async () => {
    const { db, shop, until, lead, member } = await heldParty();
    const link = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId: lead.bookingId,
      purpose: "readiness",
    });
    if (!link) throw new Error("organizer link missing");
    expect(await resolveExpiredGroupHoldOrganizer(db, { token: link.token })).toBeNull();
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId: member.bookingId,
      status: "paid",
      currency: "usd",
      amountCents: 10_000,
    });
    expect(await expireGroupHolds(db, until)).toBe(1);
    expect(
      await verifyBookingCapability(db, { token: link.token, purpose: "readiness", now: until }),
    ).toBeNull();
    expect(await resolveExpiredGroupHoldOrganizer(db, { token: link.token, now: until })).toEqual({
      shopId: shop.id,
      bookingId: lead.bookingId,
    });
    expect(
      await resolveExpiredGroupHoldOrganizer(db, { token: link.token, now: link.expiresAt }),
    ).toBeNull();
    const ledger = await issuePartySeatClaims(db, {
      shopId: shop.id,
      leadBookingId: lead.bookingId,
      now: until,
      issueClaims: false,
    });
    expect(ledger).toEqual([
      expect.objectContaining({ bookingId: member.bookingId, paymentStatus: "paid", claim: null }),
    ]);
  });

  it("never revives a readiness link revoked before expiry", async () => {
    const { db, shop, until, lead } = await heldParty();
    const link = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId: lead.bookingId,
      purpose: "readiness",
    });
    if (!link) throw new Error("organizer link missing");
    await revokeBookingCapabilities(db, { shopId: shop.id, bookingId: lead.bookingId });
    await expireGroupHolds(db, until);
    expect(
      await resolveExpiredGroupHoldOrganizer(db, { token: link.token, now: until }),
    ).toBeNull();
  });

  it("releases an abandoned provider claim instead of holding capacity forever", async () => {
    const { db, shop, until, member } = await heldParty();
    const { startPaymentOperation } = await import("./payment-operations");
    const intent = await startPaymentOperation(db, {
      shopId: shop.id,
      bookingId: member.bookingId,
      kind: "checkout_session",
    });
    await db
      .update(paymentOperationIntents)
      .set({ startedAt: new Date(until.getTime() - PAYMENT_CLAIM_STALE_AFTER_MS - 1) })
      .where(eq(paymentOperationIntents.id, intent.id));
    await db
      .update(bookings)
      .set({ pendingCheckoutIntentId: intent.id })
      .where(eq(bookings.id, member.bookingId));
    expect(await expireGroupHolds(db, until)).toBe(2);
    expect((await tripSeats()).find((seat) => seat.id === member.bookingId)).toMatchObject({
      status: "cancelled",
      pendingCheckoutIntentId: null,
    });
  });

  it("caps a hosted checkout to its earliest held seat deadline", async () => {
    const { db, shop, trip, until, member } = await heldParty();
    await upsertShopStripeAccount(db, shop.id, "acct_group_hold");
    await setShopStripeAccountStatus(db, "acct_group_hold", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    const provider = recordingCheckout();
    const result = await startBookingCheckout(
      db,
      {
        shopId: shop.id,
        tripId: trip.id,
        bookingIds: [member.bookingId],
        customerEmail: "payer@example.com",
        successUrl: "https://example.com/paid",
        cancelUrl: "https://example.com/cancel",
        describeLine: () => "Seat",
      },
      provider.provider,
    );
    expect(result.ok).toBe(true);
    expect(provider.requests[0]?.expiresAt).toEqual(until);
  });

  it("reopens an existing safe checkout inside the minimum new-session window", async () => {
    const { db, shop, trip, until, member } = await heldParty();
    await upsertShopStripeAccount(db, shop.id, "acct_group_hold");
    await setShopStripeAccountStatus(db, "acct_group_hold", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    const provider = recordingCheckout();
    const input = {
      shopId: shop.id,
      tripId: trip.id,
      bookingIds: [member.bookingId],
      customerEmail: "payer@example.com",
      successUrl: "https://example.com/paid",
      cancelUrl: "https://example.com/cancel",
      describeLine: () => "Seat",
    };
    const first = await startBookingCheckout(db, input, provider.provider);
    expect(first.ok).toBe(true);
    advanceClock(until.getTime() - nowDate().getTime() - 20 * 60_000);
    const second = await startBookingCheckout(db, input, provider.provider);
    expect(second).toMatchObject({ ok: true, reused: true });
    if (first.ok && second.ok) expect(second.checkout.id).toBe(first.checkout.id);
    expect(provider.requests).toHaveLength(1);
  });

  it("never opens a hosted page that would outlive a near-expiry hold", async () => {
    const { db, shop, trip, until, member } = await heldParty();
    await upsertShopStripeAccount(db, shop.id, "acct_group_hold");
    await setShopStripeAccountStatus(db, "acct_group_hold", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    advanceClock(until.getTime() - nowDate().getTime() - 10 * 60_000);
    const provider = recordingCheckout();
    const result = await startBookingCheckout(
      db,
      {
        shopId: shop.id,
        tripId: trip.id,
        bookingIds: [member.bookingId],
        customerEmail: "payer@example.com",
        successUrl: "https://example.com/paid",
        cancelUrl: "https://example.com/cancel",
        describeLine: () => "Seat",
      },
      provider.provider,
    );
    expect(result).toEqual({ ok: false, reason: "hold_checkout_window" });
    expect(provider.requests).toHaveLength(0);
  });

  it("opens no payment or claim authority for a due or released hold", async () => {
    const { db, shop, trip, until, member } = await heldParty();
    await upsertShopStripeAccount(db, shop.id, "acct_group_hold");
    await setShopStripeAccountStatus(db, "acct_group_hold", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    const claim = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId: member.bookingId,
      purpose: "claim",
    });
    if (!claim) throw new Error("claim missing");
    const provider = recordingCheckout();
    const input = {
      shopId: shop.id,
      tripId: trip.id,
      bookingIds: [member.bookingId],
      customerEmail: "payer@example.com",
      successUrl: "https://example.com/paid",
      cancelUrl: "https://example.com/cancel",
      describeLine: () => "Seat",
    };
    advanceClock(until.getTime() - nowDate().getTime());
    expect(await startBookingCheckout(db, input, provider.provider)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(
      await claimPartySeat(db, {
        token: claim.token,
        fullName: "Late Claimant",
        email: "late-claimant@example.com",
      }),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(await expireGroupHolds(db)).toBe(2);
    expect(await startBookingCheckout(db, input, provider.provider)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(provider.requests).toHaveLength(0);
  });

  it("gives an added companion the existing unpaid party deadline", async () => {
    const { db, shop, until, lead } = await heldParty();
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId: lead.bookingId,
      status: "paid",
      currency: "usd",
      amountCents: 10_000,
    });
    const added = await addPartySeat(db, {
      shopId: shop.id,
      leadBookingId: lead.bookingId,
      seatName: "Added Companion",
    });
    expect(added.ok).toBe(true);
    if (!added.ok) throw new Error("seat missing");
    expect((await tripSeats()).find((seat) => seat.id === added.bookingId)?.groupHoldUntil).toEqual(
      until,
    );
    expect(await expireGroupHolds(db, until)).toBe(2);
  });

  it("rejects invalid deadlines and mixed-shop parties with no partial seats", async () => {
    const { db, shop, trip } = await heldParty();
    const [other] = await db
      .insert(shops)
      .values({ name: "Other group shop", slug: "other-group-shop", timezone: "UTC" })
      .returning();
    if (!other) throw new Error("shop missing");
    const outcome = await createBookingParty(
      db,
      [
        {
          actor: "public",
          shopId: shop.id,
          tripId: trip.id,
          fullName: "No partial organizer",
          email: "no-partial@example.com",
        },
        { actor: "public", shopId: other.id, tripId: trip.id, fullName: "Other shop member" },
      ],
      { holdUntil: nowDate() },
    );
    expect(outcome.ok).toBe(false);
    expect((await tripSeats()).filter((seat) => seat.tripId === trip.id)).toHaveLength(2);
  });
});
