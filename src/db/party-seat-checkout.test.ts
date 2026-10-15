import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { recordingCheckout } from "@/test/fakes";
import { addPartySeat, cancelBooking, createBooking } from "./bookings";
import { markCheckoutPaidBySessionId, startBookingCheckout } from "./checkouts";
import { listPaidAfterCloseCheckouts } from "./checkouts-paid-after-close";
import { startPartySeatCheckout } from "./party-seat-checkout";
import { getReadyPageData } from "./ready";
import { bookings } from "./schema";
import { issuePartySeatClaims } from "./seat-claims";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import { upcomingTripsWithCounts, updateTrip } from "./trips";

const ctx = fileScopedShopContext();

/** A connected shop, a priced departure, a lead and the one friend's seat they added. */
async function leadWithSeat() {
  const { db, shop } = ctx;
  await upsertShopStripeAccount(db, shop.id, "acct_test");
  await setShopStripeAccountStatus(db, "acct_test", {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
  const trip = (await upcomingTripsWithCounts(db, shop.id, new Date(0))).find((t) =>
    t.title.startsWith("Two-Tank Reef — Molasses"),
  );
  if (!trip) throw new Error("demo reef trip missing");
  await updateTrip(db, shop.id, trip.id, {
    title: trip.title,
    startsAt: trip.startsAt,
    endsAt: trip.endsAt,
    capacity: trip.capacity,
    plannedDives: trip.plannedDives,
    priceCents: 18_000,
  });
  const lead = await createBooking(db, {
    actor: "public",
    shopId: shop.id,
    tripId: trip.id,
    fullName: "Nora Quinn",
    email: "nora-pay-seat@example.com",
  });
  if (!lead.ok) throw new Error(`lead booking failed: ${lead.reason}`);
  const added = await addPartySeat(db, {
    shopId: shop.id,
    leadBookingId: lead.bookingId,
    seatName: "Milo Quinn",
  });
  if (!added.ok) throw new Error(`seat failed: ${added.reason}`);
  const [seat] = await issuePartySeatClaims(db, { shopId: shop.id, leadBookingId: lead.bookingId });
  if (!seat) throw new Error("seat missing");
  return { db, shop, trip, leadBookingId: lead.bookingId, seatBookingId: seat.bookingId };
}

function input(
  f: Awaited<ReturnType<typeof leadWithSeat>>,
  over: { seatBookingId?: string; leadBookingId?: string } = {},
) {
  return {
    shopId: f.shop.id,
    tripId: f.trip.id,
    leadBookingId: over.leadBookingId ?? f.leadBookingId,
    seatBookingId: over.seatBookingId ?? f.seatBookingId,
    customerEmail: "nora-pay-seat@example.com",
    successUrl: "https://diveday.example/ready/t?pay=seat-paid",
    cancelUrl: "https://diveday.example/ready/t?pay=cancelled",
    describeLine: ({ tripTitle }: { tripTitle: string }) => tripTitle,
  };
}

describe("canPayPartySeats", () => {
  it("is true for a lead of a connected shop, and never for a member's page", async () => {
    const f = await leadWithSeat();
    expect((await getReadyPageData(f.db, f.leadBookingId))?.canPayPartySeats).toBe(true);
    expect((await getReadyPageData(f.db, f.seatBookingId))?.canPayPartySeats).toBe(false);
  });

  it("is false once the lead has cancelled", async () => {
    const f = await leadWithSeat();
    await cancelBooking(f.db, f.shop.id, f.leadBookingId);
    expect((await getReadyPageData(f.db, f.leadBookingId))?.canPayPartySeats).toBe(false);
  });
});

describe("startPartySeatCheckout", () => {
  it("opens a checkout for the added seat only, and its payment clears on capture", async () => {
    const f = await leadWithSeat();
    const seen = recordingCheckout();
    const outcome = await startPartySeatCheckout(f.db, input(f), seen.provider);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.checkout.totalCents).toBe(18_000);
    expect(seen.requests).toHaveLength(1);
    expect(seen.requests[0]?.lineItems).toHaveLength(1);
    expect(seen.requests[0]?.lineItems[0]?.quantity).toBe(1);
    await markCheckoutPaidBySessionId(f.db, outcome.checkout.stripeSessionId);
    const [seatAfter] = await issuePartySeatClaims(f.db, {
      shopId: f.shop.id,
      leadBookingId: f.leadBookingId,
    });
    expect(seatAfter?.payable).toBe(false);
  });

  it("offers the seat as payable until it is paid", async () => {
    const f = await leadWithSeat();
    const [seat] = await issuePartySeatClaims(f.db, {
      shopId: f.shop.id,
      leadBookingId: f.leadBookingId,
    });
    expect(seat?.payable).toBe(true);
  });

  it("refuses the lead's own booking as the seat", async () => {
    const f = await leadWithSeat();
    const seen = recordingCheckout();
    const outcome = await startPartySeatCheckout(
      f.db,
      input(f, { seatBookingId: f.leadBookingId }),
      seen.provider,
    );
    expect(outcome).toEqual({ ok: false, reason: "invalid" });
    expect(seen.requests).toHaveLength(0);
  });

  it("refuses a seat that belongs to another party", async () => {
    const f = await leadWithSeat();
    const other = await createBooking(f.db, {
      actor: "public",
      shopId: f.shop.id,
      tripId: f.trip.id,
      fullName: "Stranger Danger",
      email: "stranger@example.com",
    });
    if (!other.ok) throw new Error("booking failed");
    const seen = recordingCheckout();
    const outcome = await startPartySeatCheckout(
      f.db,
      input(f, { seatBookingId: other.bookingId }),
      seen.provider,
    );
    expect(outcome).toEqual({ ok: false, reason: "invalid" });
    expect(seen.requests).toHaveLength(0);
  });

  it("refuses a member posing as the lead", async () => {
    const f = await leadWithSeat();
    const seen = recordingCheckout();
    const outcome = await startPartySeatCheckout(
      f.db,
      input(f, { leadBookingId: f.seatBookingId, seatBookingId: f.leadBookingId }),
      seen.provider,
    );
    expect(outcome).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses another shop's seat", async () => {
    const f = await leadWithSeat();
    const seen = recordingCheckout();
    const outcome = await startPartySeatCheckout(
      f.db,
      { ...input(f), shopId: "00000000-0000-4000-8000-000000000000" },
      seen.provider,
    );
    expect(outcome.ok).toBe(false);
    expect(seen.requests).toHaveLength(0);
  });

  it("refuses a claimed seat", async () => {
    const f = await leadWithSeat();
    await f.db
      .update(bookings)
      .set({ claimedAt: nowDate() })
      .where(eq(bookings.id, f.seatBookingId));
    const seen = recordingCheckout();
    const outcome = await startPartySeatCheckout(f.db, input(f), seen.provider);
    expect(outcome).toEqual({ ok: false, reason: "invalid" });
    const [seat] = await issuePartySeatClaims(f.db, {
      shopId: f.shop.id,
      leadBookingId: f.leadBookingId,
    });
    expect(seat?.payable).toBe(false);
  });

  it("refuses a cancelled seat", async () => {
    const f = await leadWithSeat();
    await cancelBooking(f.db, f.shop.id, f.seatBookingId);
    const seen = recordingCheckout();
    const outcome = await startPartySeatCheckout(f.db, input(f), seen.provider);
    expect(outcome).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses a seat that is already paid, without a second charge", async () => {
    const f = await leadWithSeat();
    const first = await startPartySeatCheckout(f.db, input(f), recordingCheckout().provider);
    if (!first.ok) throw new Error("first checkout failed");
    await markCheckoutPaidBySessionId(f.db, first.checkout.stripeSessionId);
    const seen = recordingCheckout();
    const second = await startPartySeatCheckout(f.db, input(f), seen.provider);
    expect(second).toEqual({ ok: false, reason: "already_paid" });
    expect(seen.requests).toHaveLength(0);
  });

  it("retires a pending party session over the seat, so a later payment of it is surfaced, not double-paid (#2474)", async () => {
    const f = await leadWithSeat();
    const stripe = recordingCheckout();
    const party = await startBookingCheckout(
      f.db,
      {
        shopId: f.shop.id,
        tripId: f.trip.id,
        bookingIds: [f.leadBookingId, f.seatBookingId],
        customerEmail: "nora-pay-seat@example.com",
        successUrl: "https://diveday.example/ready/t?pay=paid",
        cancelUrl: "https://diveday.example/ready/t?pay=cancelled",
        describeLine: ({ tripTitle }: { tripTitle: string }) => tripTitle,
      },
      stripe.provider,
    );
    if (!party.ok) throw new Error(`party checkout failed: ${party.reason}`);
    const seat = await startPartySeatCheckout(f.db, input(f), stripe.provider);
    if (!seat.ok) throw new Error(`seat checkout failed: ${seat.reason}`);
    expect(seat.checkout.stripeSessionId).not.toBe(party.checkout.stripeSessionId);

    await markCheckoutPaidBySessionId(f.db, seat.checkout.stripeSessionId, "acct_test");
    await markCheckoutPaidBySessionId(f.db, party.checkout.stripeSessionId, "acct_test", 36_000);

    const owed = await listPaidAfterCloseCheckouts(f.db, f.shop.id);
    expect(owed.map((o) => o.checkoutId)).toEqual([party.checkout.id]);
  });

  it("does not hand a claimer the page the lead's address was minted for (#2474)", async () => {
    const f = await leadWithSeat();
    const stripe = recordingCheckout();
    const lead = await startPartySeatCheckout(f.db, input(f), stripe.provider);
    if (!lead.ok) throw new Error(`seat checkout failed: ${lead.reason}`);
    await f.db
      .update(bookings)
      .set({ claimedAt: nowDate() })
      .where(eq(bookings.id, f.seatBookingId));
    const claimer = await startBookingCheckout(
      f.db,
      {
        shopId: f.shop.id,
        tripId: f.trip.id,
        bookingIds: [f.seatBookingId],
        customerEmail: "milo-own@example.com",
        successUrl: "https://diveday.example/ready/t?pay=paid",
        cancelUrl: "https://diveday.example/ready/t?pay=cancelled",
        describeLine: ({ tripTitle }: { tripTitle: string }) => tripTitle,
      },
      stripe.provider,
    );
    if (!claimer.ok) throw new Error(`claimer checkout failed: ${claimer.reason}`);
    expect(claimer.reused).toBe(false);
    expect(claimer.checkout.stripeSessionId).not.toBe(lead.checkout.stripeSessionId);
    expect(claimer.checkout.customerEmail).toBe("milo-own@example.com");
  });
});
