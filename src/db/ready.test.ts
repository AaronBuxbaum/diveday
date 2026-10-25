import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { DIVER_LOCALES } from "@/i18n/settings";
import { nowDate } from "@/lib/clock";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { fileScopedShopContext } from "@/test/db";
import {
  addPartySeat,
  cancelBooking,
  confirmCarriedFacts,
  createBooking,
  setBookingLastDived,
} from "./bookings";
import { recordMoveAsk } from "./inbound-messages";
import { setBookingPayment } from "./payments";
import {
  createCertification,
  getBookingReadiness,
  reviewCertification,
  upsertTripRequirements,
} from "./readiness";
import { carriedPreparationForDiver, getBookedCard, getReadyPageData } from "./ready";
import { getRentalFit, toDiverRentalFit } from "./rental-fit";
import {
  bookings,
  people,
  priorVisits,
  rollCallEvents,
  shops,
  trips as tripTable,
  waiverRecords,
} from "./schema";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import { getTripRoster, listStaff, setTripStatus, upcomingTripsWithCounts } from "./trips";
import { completeWaiver } from "./waivers";
import { issueWaiverRequest } from "./waivers-requests";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

async function seededBooking() {
  const { db, shop } = ctx;
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  if (!trip) throw new Error("demo trip missing");
  const [entry] = await getTripRoster(db, shop.id, trip.id);
  if (!entry) throw new Error("demo booking missing");
  return { db, shop, trip, booking: entry.booking, person: entry.person };
}

/** A fresh unpaid booking on the seeded "open" reef trip. */
async function unpaidBooking() {
  const { db, shop } = ctx;
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

  it("marks a canceled booking so the page (and its write actions) refuse it", async () => {
    const { db, shop, booking } = await seededBooking();
    await cancelBooking(db, shop.id, booking.id);
    const data = await getReadyPageData(db, booking.id);
    // The loader still resolves so the page can say "cancelled" plainly; the
    // transactional actions read this same flag and refuse to write.
    expect(data?.detail.cancelled).toBe(true);
    // The *departure* is a different fact, and it is still perfectly on.
    expect(data?.departureCancelled).toBe(false);
  });

  it("reports a canceled departure separately from a canceled booking", async () => {
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
  /** Fourth UX review, item 5: a priced, unpaid seat with no card to take is owed at the shop. */
  it("marks a priced seat the page cannot charge as owed at the shop, and a paid one not", async () => {
    const { db, shop, bookingId } = await unpaidBooking();
    expect((await getReadyPageData(db, bookingId))?.owesAtShop).toBe(true);
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId,
      status: "paid",
      currency: "usd",
      amountCents: 12_000,
      provider: "cash",
      providerRef: null,
    });
    expect((await getReadyPageData(db, bookingId))?.owesAtShop).toBe(false);
  });

  /** UX review 2026-10-11, item 13: the page draws "Add a seat" only where it can work. */
  it("offers a seat to add on a booking that may lead one, never on a party member's seat", async () => {
    const { db, shop, bookingId } = await unpaidBooking();
    expect((await getReadyPageData(db, bookingId))?.canAddSeat).toBe(true);
    const added = await addPartySeat(db, {
      shopId: shop.id,
      leadBookingId: bookingId,
      seatName: "Milo",
    });
    if (!added.ok) throw new Error("add failed");
    expect((await getReadyPageData(db, bookingId))?.canAddSeat).toBe(true);
    expect((await getReadyPageData(db, added.bookingId))?.canAddSeat).toBe(false);
  });

  /**
   * Layer 3 review (dde-2 #1, dde-1 F2): a seat the desk released before the
   * boat left is not the diver's to pay for or prepare. Without this, a diver
   * turned away for payment at 07:00 pays at 07:10 for a seat the shop has
   * already sold, and the page walks them through the checklist to the boat.
   */
  it("neither charges for nor prepares a seat the desk released", async () => {
    const { db, shop, bookingId } = await unpaidBooking();
    await upsertShopStripeAccount(db, shop.id, "acct_ready_released");
    await setShopStripeAccountStatus(db, "acct_ready_released", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    const held = await getReadyPageData(db, bookingId);
    expect(held?.canPay).toBe(true);
    expect(held?.seatReleased).toBe(false);
    await db
      .update(bookings)
      .set({ status: "no_show", turnedAwayAt: nowDate(), turnedAwayReason: "payment" })
      .where(eq(bookings.id, bookingId));
    const released = await getReadyPageData(db, bookingId);
    expect(released?.canPay).toBe(false);
    expect(released?.seatReleased).toBe(true);
    expect(released?.turnedAway).toBe(true);
    // Erasure-shaped: the fact without the category still reads turned away.
    await db.update(bookings).set({ turnedAwayReason: null }).where(eq(bookings.id, bookingId));
    expect((await getReadyPageData(db, bookingId))?.turnedAway).toBe(true);
  });

  /**
   * Security review of layer 8, D3: the link is shared by design, so a lead
   * who has not paid on a page that takes payment cannot fill the boat with
   * unpaid seats. Paying (or a page that takes no payment) opens the door.
   */
  it("offers no seat to add until a lead the page could charge has paid", async () => {
    const { db, shop, bookingId } = await unpaidBooking();
    await upsertShopStripeAccount(db, shop.id, "acct_ready_add_seat");
    await setShopStripeAccountStatus(db, "acct_ready_add_seat", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    const owing = await getReadyPageData(db, bookingId);
    expect(owing?.canPay).toBe(true);
    expect(owing?.canAddSeat).toBe(false);
    // A page that can take the card is not money owed at the shop.
    expect(owing?.owesAtShop).toBe(false);

    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId,
      status: "paid",
      currency: "usd",
      amountCents: 12_000,
      provider: "stripe",
      providerRef: "pi_ready_add_seat",
    });
    expect((await getReadyPageData(db, bookingId))?.canAddSeat).toBe(true);
  });

  it("offers no seat to add on a held seat or a canceled one", async () => {
    const { db, shop, bookingId } = await unpaidBooking();
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: nowDate(), identityBookedAs: "Nora Q" })
      .where(eq(bookings.id, bookingId));
    expect((await getReadyPageData(db, bookingId))?.canAddSeat).toBe(false);
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: null, identityBookedAs: null })
      .where(eq(bookings.id, bookingId));
    await cancelBooking(db, shop.id, bookingId);
    expect((await getReadyPageData(db, bookingId))?.canAddSeat).toBe(false);
  });

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

  /**
   * H-126: "Ask to move" is offered exactly when a cancel would forfeit what
   * was paid, and says it was asked once it has been.
   */
  it("offers Ask to move only past the free window on a paid seat, then says it was asked", async () => {
    const { db, shop, open, bookingId } = await unpaidBooking();
    // Unpaid: a cancel costs nothing, so there is nothing to ask instead.
    expect((await getReadyPageData(db, bookingId))?.moveAsk).toBeNull();
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId,
      status: "paid",
      currency: "usd",
      amountCents: 12_000,
      provider: "stripe",
      providerRef: "pi_move_ask",
    });
    // Inside a generous window the cancel refunds.
    await db.update(tripTable).set({ cancellationWindowHours: 1 }).where(eq(tripTable.id, open.id));
    expect((await getReadyPageData(db, bookingId))?.cancelPreview).toBe("refund");
    expect((await getReadyPageData(db, bookingId))?.moveAsk).toBeNull();
    // A window wider than the time left: the cancel forfeits.
    await db
      .update(tripTable)
      .set({ cancellationWindowHours: 24 * 365 })
      .where(eq(tripTable.id, open.id));
    const past = await getReadyPageData(db, bookingId);
    expect(past?.cancelPreview).toBe("forfeit");
    expect(past?.moveAsk).toBe("open");
    const sentAt = nowDate();
    await recordMoveAsk(db, { shopId: shop.id, bookingId, note: "Any Saturday", now: sentAt });
    expect((await getReadyPageData(db, bookingId))?.moveAsk).toEqual({
      note: "Any Saturday",
      sentAt,
    });
    // Refresh reads the persisted note and its original send time.
    expect((await getReadyPageData(db, bookingId))?.moveAsk).toEqual({
      note: "Any Saturday",
      sentAt,
    });
    // A held seat is owed nothing (#2125).
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: nowDate() })
      .where(eq(bookings.id, bookingId));
    expect((await getReadyPageData(db, bookingId))?.moveAsk).toBeNull();
  });

  /**
   * Dive-domain review N1 of layer r4-1: a paid seat at a shop with no
   * cancellation window refunds nothing right away either, so the diver may
   * ask to move instead there too.
   */
  it("offers Ask to move on a paid seat when the trip has no cancellation window", async () => {
    const { db, shop, open, bookingId } = await unpaidBooking();
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId,
      status: "paid",
      currency: "usd",
      amountCents: 12_000,
      provider: "stripe",
      providerRef: "pi_move_ask_no_policy",
    });
    await db
      .update(tripTable)
      .set({ cancellationWindowHours: null })
      .where(eq(tripTable.id, open.id));
    const data = await getReadyPageData(db, bookingId);
    expect(data?.cancelPreview).toBe("no_policy");
    expect(data?.moveAsk).toBe("open");
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

  it("withdraws the cancel inside the late hour once the dock counted the diver aboard (H-133)", async () => {
    // `selfCancelBooking` refuses this seat (`aboardAtSeaBookingIds`), so the
    // page must not offer it.
    const { db, shop, open, bookingId } = await unpaidBooking();
    const midBuffer = new Date(open.startsAt.getTime() + 20 * 60 * 1000);
    expect((await getReadyPageData(db, bookingId, midBuffer))?.canCancelBooking).toBe(true);
    const [recorder] = await listStaff(db, shop.id);
    if (!recorder) throw new Error("seeded staff missing");
    await db.insert(rollCallEvents).values({
      shopId: shop.id,
      tripId: open.id,
      bookingId,
      recordedByPersonId: recorder.person.id,
      status: "boarded",
      checkpoint: "departure",
      occurredAt: new Date(open.startsAt.getTime() + 5 * 60 * 1000),
    });
    expect((await getReadyPageData(db, bookingId, midBuffer))?.canCancelBooking).toBe(false);
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
    const before = await getReadyPageData(db, bookingId);
    expect(before).not.toBeNull();
    expect(before?.lastDivedBand).toBeNull();
    const readinessBefore = before?.detail.readiness;

    expect(
      await setBookingLastDived(db, { shopId: shop.id, bookingId, band: "over_five_years" }),
    ).toBe(true);
    const data = await getReadyPageData(db, bookingId);
    expect(data?.lastDivedBand).toBe("over_five_years");
    // And it moves nothing else: currency is not a gate.
    expect(data?.detail.readiness).toEqual(readinessBefore);
  });

  it("refuses to record currency against a canceled seat", async () => {
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

  /**
   * **What the "Anything changed?" step is built from** (ADR
   * 20260904-reef-all-the-way-down, D15 and D14).
   *
   * The emergency contact reaches the page as an explicit two-field projection
   * — the same boundary `toDiverRentalFit` draws — and the confirmation reaches
   * it as its own value rather than as raw columns on the fit.
   */
  it("carries the diver's own emergency contact, and null where they gave none", async () => {
    const { db, bookingId } = await unpaidBooking();
    const fresh = await getReadyPageData(db, bookingId);
    expect(fresh?.emergencyContact).toEqual({ name: null, phone: null });

    const { db: seeded, booking } = await seededBooking();
    const named = await getReadyPageData(seeded, booking.id);
    expect(named?.emergencyContact).toHaveProperty("name");
    expect(named?.emergencyContact).toHaveProperty("phone");
    // The whole person row never crosses: two fields, and no more.
    expect(Object.keys(named?.emergencyContact ?? {}).sort()).toEqual(["name", "phone"]);
  });

  it("carries when the seat was booked, and whether the question has been answered", async () => {
    const { db, shop, bookingId } = await unpaidBooking();
    const data = await getReadyPageData(db, bookingId);
    expect(data?.bookingCreatedAt).toBeInstanceOf(Date);
    // Nothing backfills the answer — an unasked question reads as unanswered.
    expect(data?.carriedFactsConfirmedAt).toBeNull();

    expect(await confirmCarriedFacts(db, { shopId: shop.id, bookingId })).toBe(true);
    expect((await getReadyPageData(db, bookingId))?.carriedFactsConfirmedAt).toBeInstanceOf(Date);
  });

  it("claims no fit confirmation for a fit nobody kept", async () => {
    const { db, bookingId } = await unpaidBooking();
    expect((await getReadyPageData(db, bookingId))?.fitConfirmation).toBeNull();
  });

  // Issue #2795: whether a course student's packing list suggests a logbook.
  it("says whether the diver holds any certification card, verified or not", async () => {
    const { db, shop, bookingId } = await unpaidBooking();
    expect((await getReadyPageData(db, bookingId))?.holdsCertification).toBe(false);
    const [seat] = await db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    const card = await createCertification(db, {
      shopId: shop.id,
      personId: seat.personId,
      agency: "padi",
      level: "open_water",
      identifier: "PADI-OW-LOGBOOK",
    });
    expect(card, "an unreviewed card").not.toBeNull();
    expect((await getReadyPageData(db, bookingId))?.holdsCertification).toBe(true);
  });
});

/**
 * **A held seat's link** (issue #2082). A booking that attached itself to an
 * existing person on something short of proof (`identity_unconfirmed_at`) may
 * not be that person at all — a shared family email is the ordinary case — so
 * until staff confirm it, the link must not read back the matched person's
 * particulars. The flag gates disclosure (H-13, 2026-09-11).
 */
describe("a held seat's ready page", () => {
  it("withholds the matched person's contact and sizes until staff confirm who it is", async () => {
    const { db, shop, booking } = await seededBooking();
    await db
      .update(people)
      .set({ emergencyContactName: "Held Contact", emergencyContactPhone: "555-0101" })
      .where(eq(people.id, booking.personId));
    const onFile = toDiverRentalFit(await getRentalFit(db, shop.id, booking.personId));

    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: nowDate(), identityBookedAs: "Tom Marsh" })
      .where(eq(bookings.id, booking.id));
    const held = await getReadyPageData(db, booking.id);
    expect(held?.identityHeld).toBe(true);
    // The page greets the name the booker typed, never the matched person's
    // (issue #2125).
    expect(held?.greetingName).toBe("Tom Marsh");
    expect(held?.emergencyContact).toEqual({ name: null, phone: null });
    expect(held?.rentalFit).toBeNull();
    expect(held?.fitConfirmation).toBeNull();

    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: null })
      .where(eq(bookings.id, booking.id));
    const confirmed = await getReadyPageData(db, booking.id);
    expect(confirmed?.identityHeld).toBe(false);
    expect(confirmed?.greetingName).toBe(confirmed?.detail.person.fullName);
    expect(confirmed?.emergencyContact).toEqual({ name: "Held Contact", phone: "555-0101" });
    expect(confirmed?.rentalFit).toEqual(onFile);
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
    const { db, shop } = ctx;
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
    const { db, shop } = ctx;
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
    const { db, shop } = ctx;
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

/**
 * **The booked card's own read** (UX review 2026-10-10, item 7). `/ready`
 * after a booking used to wait on the whole thread's reads, the trip's entire
 * readiness roster among them, before it could say the seat was taken. This is
 * the one narrow read the first paint makes instead, so it must agree with the
 * full loader on every fact the masthead prints.
 */
describe("getBookedCard", () => {
  it("states the masthead's facts exactly as the full loader does", async () => {
    const { db, shop, bookingId } = await unpaidBooking();
    const card = await getBookedCard(db, { shopId: shop.id, bookingId, delivered: true });
    const data = await getReadyPageData(db, bookingId);
    if (!card || !data) throw new Error("expected both reads to resolve");
    expect(card.trip).toEqual({
      id: data.detail.trip.id,
      title: data.detail.trip.title,
      startsAt: data.detail.trip.startsAt,
      endsAt: data.detail.trip.endsAt,
    });
    expect(card.shop).toMatchObject({
      name: data.detail.shop.name,
      slug: data.shop.slug,
      timezone: data.detail.shop.timezone,
      defaultLocale: data.shop.defaultLocale,
      dockCallMinutes: data.shop.dockCallMinutes,
    });
    expect(card.greetingName).toBe(data.greetingName);
    expect(card.greetingName).toBe("Nora Quinn");
    expect(card.pickup).toEqual({
      time: data.pickupTime,
      location: data.hotelPickupLocation,
    });
    expect(card.bookingCancelled).toBe(false);
    expect(card.departureCancelled).toBe(false);
  });

  // Hotel pickups switched off (the Features page) stops the question only: a
  // pickup a seat already holds still happens, so both reads still say it.
  it("still says a pickup already set after the shop stops offering them", async () => {
    const { db, shop, bookingId } = await unpaidBooking();
    await db
      .update(bookings)
      .set({ hotelPickupLocation: "Harbor Inn", pickupTime: "07:15" })
      .where(eq(bookings.id, bookingId));
    await db.update(shops).set({ offersHotelPickup: true }).where(eq(shops.id, shop.id));
    expect(
      (await getBookedCard(db, { shopId: shop.id, bookingId, delivered: true }))?.pickup,
    ).toEqual({ time: "07:15", location: "Harbor Inn" });

    await db.update(shops).set({ offersHotelPickup: false }).where(eq(shops.id, shop.id));
    expect(
      (await getBookedCard(db, { shopId: shop.id, bookingId, delivered: true }))?.pickup,
    ).toEqual({ time: "07:15", location: "Harbor Inn" });
    const data = await getReadyPageData(db, bookingId);
    expect([data?.hotelPickupLocation, data?.pickupTime]).toEqual(["Harbor Inn", "07:15"]);
    expect(data?.offersHotelPickup).toBe(false);
  });

  it("says when the seat or the departure is gone, so the page can decline the fast path", async () => {
    const { db, shop, open, bookingId } = await unpaidBooking();
    await cancelBooking(db, shop.id, bookingId);
    expect(
      (await getBookedCard(db, { shopId: shop.id, bookingId, delivered: true }))?.bookingCancelled,
    ).toBe(true);
    await setTripStatus(db, shop.id, open.id, "cancelled");
    expect(
      (await getBookedCard(db, { shopId: shop.id, bookingId, delivered: true }))
        ?.departureCancelled,
    ).toBe(true);
  });

  // H-128: the diver's side of a regular's milestone, said on the booked moment.
  it("names a milestone boat, counting the shop's imported visits, and only that boat", async () => {
    const { db, shop, bookingId } = await unpaidBooking();
    expect(
      (await getBookedCard(db, { shopId: shop.id, bookingId, delivered: true }))?.milestone,
    ).toBeNull();
    const [seat] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    if (!seat) throw new Error("seat missing");
    await db.insert(priorVisits).values(
      Array.from({ length: 9 }, (_, index) => ({
        shopId: shop.id,
        personId: seat.personId,
        visitedOn: `2024-0${index + 1}-10`,
        dedupeKey: `ready-milestone-${index}`,
        importedAt: nowDate(),
      })),
    );
    expect(
      (await getBookedCard(db, { shopId: shop.id, bookingId, delivered: true }))?.milestone,
    ).toBe(10);
    // A booking redirect proved only a typed name and address: no count of
    // that record's days on it (security review r5-4, second pass, N-c).
    expect(
      (await getBookedCard(db, { shopId: shop.id, bookingId, delivered: false }))?.milestone,
    ).toBeNull();
    // A held seat speaks for a record nobody has matched yet: no count of it.
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: nowDate(), identityBookedAs: "N. Q." })
      .where(eq(bookings.id, bookingId));
    expect(
      (await getBookedCard(db, { shopId: shop.id, bookingId, delivered: true }))?.milestone,
    ).toBeNull();
  });

  it("greets a held identity by the name it was booked as, never the matched record's", async () => {
    const { db, shop, bookingId } = await unpaidBooking();
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: nowDate(), identityBookedAs: "N. Q." })
      .where(eq(bookings.id, bookingId));
    expect(
      (await getBookedCard(db, { shopId: shop.id, bookingId, delivered: true }))?.greetingName,
    ).toBe("N. Q.");
  });

  /**
   * **The card is a seat claim, never a boarding claim** (dive-domain review,
   * 2026-10-12). The fast path paints it from this one row and deliberately
   * reads no readiness, so a diver held for medical review or short a
   * certification level gets it too, with the hold in the thread directly
   * under it. The heading it greets them with must therefore be true of every
   * live booking: "You've got a seat", not "You're on the boat".
   */
  it("still resolves for a medical_review or certification_insufficient booking, and its heading claims only the seat", async () => {
    const { db, shop, open, bookingId } = await unpaidBooking();
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId });
    if (!issued.ok) throw new Error(`waiver issue failed: ${issued.reason}`);
    const signed = await completeWaiver(db, issued.token, {
      signerName: "Nora Quinn",
      agreed: true,
      medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
    });
    if (!signed.ok) throw new Error("waiver completion failed");
    await db
      .update(waiverRecords)
      .set({ status: "medical_review" })
      .where(eq(waiverRecords.bookingId, bookingId));
    await upsertTripRequirements(db, {
      shopId: shop.id,
      tripId: open.id,
      requiresWaiver: true,
      minimumCertificationLevel: "rescue",
      requiredSpecialties: [],
      requiresNitrox: false,
      requiresPayment: false,
    });
    const [nora] = await db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    if (!nora) throw new Error("booking row missing");
    const lowerCard = await createCertification(db, {
      shopId: shop.id,
      personId: nora.personId,
      agency: "padi",
      level: "open_water",
      identifier: "PADI-OW-SEAT-CLAIM",
    });
    if (!lowerCard) throw new Error("expected certification to insert");
    await reviewCertification(db, {
      shopId: shop.id,
      certificationId: lowerCard.id,
      status: "verified",
    });

    const readiness = await getBookingReadiness(db, shop.id, bookingId);
    expect(readiness?.status).toBe("blocked");
    expect(readiness?.blockers).toContainEqual(expect.objectContaining({ code: "medical_review" }));
    expect(readiness?.blockers).toContainEqual(
      expect.objectContaining({ code: "certification_insufficient" }),
    );

    const card = await getBookedCard(db, { shopId: shop.id, bookingId, delivered: true });
    expect(card?.bookingCancelled).toBe(false);
    for (const locale of DIVER_LOCALES) {
      const heading = diverTranslator(locale)("booking.confirmedHeading", {
        name: card?.greetingName.split(" ")[0] ?? "",
      });
      expect(heading, locale).not.toMatch(/on the boat|a bordo|aboard/i);
    }
    expect(diverTranslator("en-US")("booking.confirmedHeading", { name: "Nora" })).toBe(
      "You’ve got a seat, Nora",
    );
    expect(diverTranslator("es-ES")("booking.confirmedHeading", { name: "Nora" })).toBe(
      "Tu plaza está reservada, Nora",
    );
  });

  it("resolves nothing for a booking that does not exist", async () => {
    const { db, shop } = await unpaidBooking();
    expect(
      await getBookedCard(db, {
        shopId: shop.id,
        bookingId: "00000000-0000-4000-8000-000000000000",
        delivered: true,
      }),
    ).toBeNull();
  });

  it("resolves nothing for a booking under another shop, whatever id the caller holds", async () => {
    const { db, bookingId } = await unpaidBooking();
    expect(
      await getBookedCard(db, {
        shopId: "00000000-0000-4000-8000-000000000000",
        bookingId,
        delivered: true,
      }),
    ).toBeNull();
  });
});
