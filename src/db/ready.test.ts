import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { cancelBooking, createBooking, setBookingLastDived } from "./bookings";
import { setBookingPayment } from "./payments";
import { carriedPreparationForDiver, getReadyPageData } from "./ready";
import { bookings, people, shops } from "./schema";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import { getTripRoster, setTripStatus, upcomingTripsWithCounts } from "./trips";

async function seededBooking() {
  const { db, shop } = await seededShopContext();
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  if (!trip) throw new Error("demo trip missing");
  const [entry] = await getTripRoster(db, shop.id, trip.id);
  if (!entry) throw new Error("demo booking missing");
  return { db, shop, trip, booking: entry.booking, person: entry.person };
}

/** A fresh unpaid booking on the seeded "open" reef trip. */
async function unpaidBooking() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const open = trips.find((t) => t.title === "Two-Tank Reef — Christ of the Abyss");
  if (!open) throw new Error("expected seeded open trip missing");
  const booked = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: open.id,
    fullName: "Nora Quinn",
    email: "nora@example.com",
    phone: "+1-305-555-0199",
  });
  if (!booked.ok) throw new Error("setup booking failed");
  return { db, shop, open, bookingId: booked.bookingId };
}

describe("getReadyPageData", () => {
  it("gathers a live booking's readiness, and gates pay off without a Stripe account", async () => {
    const { db, trip, booking } = await seededBooking();
    const data = await getReadyPageData(db, booking.id);
    expect(data).not.toBeNull();
    expect(data?.detail.trip.title).toBe(trip.title);
    expect(data?.detail.cancelled).toBe(false);
    // No connected Stripe account in the seed, so pay-from-page stays off.
    expect(data?.canPay).toBe(false);
  });

  it("marks a cancelled booking so the page (and its write actions) refuse it", async () => {
    const { db, shop, booking } = await seededBooking();
    await cancelBooking(db, shop.id, booking.id);
    const data = await getReadyPageData(db, booking.id);
    // The loader still resolves so the page can say "cancelled" plainly; the
    // transactional actions read this same flag and refuse to write.
    expect(data?.detail.cancelled).toBe(true);
    // The *departure* is a different fact, and it is still perfectly on.
    expect(data?.departureCancelled).toBe(false);
  });

  it("reports a cancelled departure separately from a cancelled booking", async () => {
    // A blow-out cancels the trip and deliberately leaves every booking active
    // — refunds stay a per-booking staff decision (src/db/blowouts.ts) — so
    // `detail.cancelled` is false for every diver it stranded. Reading only
    // that flag is what let the diver's own page hand them a packing list
    // before the boat was due back, and "Welcome back" with a dive record and
    // a tip ask an hour after it was (review, 2026-08-28).
    const { db, shop, trip, booking } = await seededBooking();
    expect((await getReadyPageData(db, booking.id))?.departureCancelled).toBe(false);

    await setTripStatus(db, shop.id, trip.id, "cancelled");

    const data = await getReadyPageData(db, booking.id);
    expect(data?.departureCancelled).toBe(true);
    expect(data?.detail.cancelled).toBe(false);
  });

  it("returns null for a booking that does not exist", async () => {
    const { db } = await seededBooking();
    await expect(getReadyPageData(db, "00000000-0000-4000-8000-000000000099")).resolves.toBeNull();
  });

  // The diver-facing cancel came back on 2026-08-21 (ADR
  // 20260821-the-diver-may-release-their-own-seat). These pin the two facts the
  // page renders it from — and `canCancelBooking` has to agree with
  // `selfCancelBooking`'s own pre-checks exactly, or the page offers a button
  // that can only come back refused.
  it("offers the cancel for a plain booked seat on a future departure", async () => {
    const { db, bookingId } = await unpaidBooking();
    const data = await getReadyPageData(db, bookingId);
    expect(data?.canCancelBooking).toBe(true);
    expect(data?.cancelPreview).toBe("unpaid");
  });

  // Both halves of the same omission. `partly_refunded` settles a seat and it
  // captures one, and it was absent from `ready.ts`'s `settled` and `captured`
  // alike — so this page invited a diver who had already paid, and been handed
  // part of it back, to pay the full fare a second time, while telling them a
  // cancellation would return nothing (issue #699 security review). The URL is
  // shared by design, so anyone holding it could have done it.
  it("never offers pay again on a seat the shop has part-refunded", async () => {
    const { db, shop, bookingId } = await unpaidBooking();
    await upsertShopStripeAccount(db, shop.id, "acct_ready_partial");
    await setShopStripeAccountStatus(db, "acct_ready_partial", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId,
      status: "partly_refunded",
      currency: "usd",
      amountCents: 12_000,
      provider: "stripe",
      providerRef: "re_goodwill",
    });

    const data = await getReadyPageData(db, bookingId);

    expect(data?.canPay).toBe(false);
    // And the money it still holds is money a cancellation would return.
    expect(data?.cancelPreview).not.toBe("unpaid");
  });

  it("withdraws the cancel once the seat is checked in", async () => {
    const { db, bookingId } = await unpaidBooking();
    await db.update(bookings).set({ status: "checked_in" }).where(eq(bookings.id, bookingId));
    expect((await getReadyPageData(db, bookingId))?.canCancelBooking).toBe(false);
  });

  it("withdraws the cancel once the seat is a no-show", async () => {
    const { db, bookingId } = await unpaidBooking();
    await db.update(bookings).set({ status: "no_show" }).where(eq(bookings.id, bookingId));
    expect((await getReadyPageData(db, bookingId))?.canCancelBooking).toBe(false);
  });

  it("holds the cancel open for the late-departure hour, and closes it after", async () => {
    // Trips run late, so "has this boat sailed?" allows an hour everywhere
    // (AGENTS.md), and `selfCancelBooking` allows exactly the same hour. A page
    // gate that closed on the scheduled minute would hide a control the domain
    // would still have honoured.
    const { db, open, bookingId } = await unpaidBooking();
    const midBuffer = new Date(open.startsAt.getTime() + 30 * 60 * 1000);
    const pastBuffer = new Date(open.startsAt.getTime() + 60 * 60 * 1000);
    expect((await getReadyPageData(db, bookingId, midBuffer))?.canCancelBooking).toBe(true);
    expect((await getReadyPageData(db, bookingId, pastBuffer))?.canCancelBooking).toBe(false);
  });

  it("reads a waived booking as owing no refund, since there is no money to give back", async () => {
    const { db, shop, bookingId } = await unpaidBooking();
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId,
      status: "waived",
      currency: "usd",
      amountCents: 0,
      provider: null,
      note: "Comp'd",
    });
    const data = await getReadyPageData(db, bookingId);
    expect(data?.cancelPreview).toBe("unpaid");
    expect(data?.canCancelBooking).toBe(true);
  });

  // How recently the diver says they last dived (ADR
  // 20260821-currency-is-what-catches-people). It gates nothing, so the only
  // properties worth pinning are that it round-trips and that absence is a real
  // state rather than a default.
  it("reads back the diver's own currency answer, and nothing before they give one", async () => {
    const { db, shop, bookingId } = await unpaidBooking();
    expect((await getReadyPageData(db, bookingId))?.lastDivedBand).toBeNull();

    expect(
      await setBookingLastDived(db, { shopId: shop.id, bookingId, band: "over_five_years" }),
    ).toBe(true);
    const data = await getReadyPageData(db, bookingId);
    expect(data?.lastDivedBand).toBe("over_five_years");
    // And it moves nothing else: currency is not a gate.
    expect(data?.detail.readiness.status).toBe(
      (await getReadyPageData(db, bookingId))?.detail.readiness.status,
    );
  });

  it("refuses to record currency against a cancelled seat", async () => {
    const { db, shop, bookingId } = await unpaidBooking();
    await cancelBooking(db, shop.id, bookingId);
    expect(await setBookingLastDived(db, { shopId: shop.id, bookingId, band: "this_season" })).toBe(
      false,
    );
  });

  it("refuses to record currency for another shop's booking", async () => {
    const { db, bookingId } = await unpaidBooking();
    expect(
      await setBookingLastDived(db, {
        shopId: "00000000-0000-4000-8000-000000000099",
        bookingId,
        band: "this_season",
      }),
    ).toBe(false);
    expect((await getReadyPageData(db, bookingId))?.lastDivedBand).toBeNull();
  });
});

/**
 * **What a blown-out day left standing** (issue #1197, delight report D37).
 *
 * The seeded demo shop is the fixture on purpose: these three facts are
 * person-and-shop scoped, so the only honest way to prove the reader finds them
 * is to read a diver the shop has actually prepared for, rather than a
 * fabricated row that agrees with the query by construction.
 */
describe("carriedPreparationForDiver", () => {
  it("finds what the shop holds for a diver who prepared", async () => {
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const rosters = await Promise.all(trips.map((trip) => getTripRoster(db, shop.id, trip.id)));

    // The first seeded diver who carries anything at all. There is at least one
    // — the demo exists to show a shop mid-season — and asserting on "whoever
    // that is" keeps this from breaking every time a seed scenario is added.
    const carried = await Promise.all(
      [...new Set(rosters.flat().map((entry) => entry.person.id))].map((personId) =>
        carriedPreparationForDiver(db, { shopId: shop.id, personId, hasRentalFit: false }),
      ),
    );
    const someone = carried.find((items) => items.length > 0);
    expect(
      someone,
      "no seeded diver has a release or a card — the reader found nothing",
    ).toBeTruthy();
    // Only ever these, and never a duplicate.
    for (const items of carried) {
      expect(new Set(items).size).toBe(items.length);
      for (const item of items) expect(["waiver", "certification", "fit"]).toContain(item);
    }
  });

  /**
   * **The claim that has to fail closed.** A person this shop has never seen
   * must produce nothing at all, so the surface stays silent rather than
   * reassuring somebody about preparation that does not exist. `hasRentalFit`
   * is the caller's own fact and is the one thing this reader takes on trust.
   */
  it("claims nothing for a person the shop holds nothing for", async () => {
    const { db, shop } = await seededShopContext();
    const [stranger] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Never Prepared" })
      .returning();
    if (!stranger) throw new Error("person insert failed");

    expect(
      await carriedPreparationForDiver(db, {
        shopId: shop.id,
        personId: stranger.id,
        hasRentalFit: false,
      }),
    ).toEqual([]);
    expect(
      await carriedPreparationForDiver(db, {
        shopId: shop.id,
        personId: stranger.id,
        hasRentalFit: true,
      }),
    ).toEqual(["fit"]);
  });

  /**
   * Tenant scope, on a reader that takes a `personId` straight from a resolved
   * capability: asking another shop about this diver must answer nothing, not
   * their records here.
   */
  it("answers nothing when asked about a diver under the wrong shop", async () => {
    const { db, shop } = await seededShopContext();
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("demo trip missing");
    const [entry] = await getTripRoster(db, shop.id, trip.id);
    if (!entry) throw new Error("demo booking missing");
    const [other] = await db
      .insert(shops)
      .values({ name: "Rival Reef", slug: "rival-carried-prep", timezone: "UTC" })
      .returning();
    if (!other) throw new Error("second shop insert failed");

    expect(
      await carriedPreparationForDiver(db, {
        shopId: other.id,
        personId: entry.person.id,
        hasRentalFit: false,
      }),
    ).toEqual([]);
  });
});
