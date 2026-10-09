import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone, shiftCalendarDate } from "@/lib/calendar-date";
import { nowDate, nowMs } from "@/lib/clock";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { assembleDaySpine, sortStationRows } from "@/lib/today";
import { dbNowPlus, fileScopedShopContext } from "@/test/db";
import { fakePromotions } from "@/test/fakes";
import { createBoat } from "./boats";
import { cancelBooking, createBookingParty } from "./bookings";
import { createGearItem, recordGearService, reserveGearUnit, returnGearReservation } from "./gear";
import { markInboundAnswered, recordInboundMessage } from "./inbound-messages";
import { joinLastMinuteList } from "./last-minute-list";
import { getTripManifest, recordCrewRollCall, recordRollCall } from "./manifests";
import { queueMediaDeletion, resolveMediaDeletion } from "./media-deletions";
import { setBookingNitrox } from "./nitrox";
import { recordNotificationDelivery } from "./notifications";
import { startPaymentOperation } from "./payment-operations";
import { setBookingPayment } from "./payments";
import { listTripReadiness } from "./readiness";
import { saveRentalFit } from "./rental-fit";
import { submitTripReview } from "./reviews";
import {
  boats as boatsTable,
  bookings as bookingsTable,
  courses,
  inboundMessages,
  nitroxCertifications,
  people,
  personRoles as personRolesTable,
  rollCallCrewEvents as rollCallCrewEventsTable,
  rollCallEvents as rollCallEventsTable,
  shops as shopsTable,
  tripAssignments,
  tripReviews,
  trips as tripsTable,
  tripWaitlistEntries,
  workOrders as workOrdersTable,
} from "./schema";
import { markShopUnitsConfirmed } from "./shops";
import { createStaffCredential } from "./staff-credentials";
import { getStaffingView } from "./staffing";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import { countBlockedDiversNextBoatDay, getTodayWork } from "./today";
import { sendLastMinuteDealBlast } from "./trip-promos";
import { recordTripStage } from "./trip-stages";
import {
  createTrip,
  getTripRoster,
  listStaff,
  moveTrip,
  setTripCrew,
  setTripStatus,
  upcomingTripsWithCounts,
} from "./trips";
import { completeWaiver, issueWaiverRequest } from "./waivers";
import { addCustomerGearItem, createWorkOrder, setWorkOrderStatus } from "./work-orders";

const clearAnswers = emptyMedicalAnswers(RSTC_QUESTIONNAIRE);

/**
 * One database for the file, one transaction per test (ADR-less; see
 * `fileScopedShopContext` in src/test/db.ts, issue #1244).
 *
 * This file was 72 tests each hydrating its own snapshot at ~0.7s, and on
 * 2026-09-02 its first test tripped Vitest's 20s ceiling on CI — a timeout
 * inside `seededShopContext()`, not an assertion, on a shard whose workers were
 * contending. That is the same "flake with a runway" #1271 described for
 * `seed.test.ts`: nothing is wrong with the test, it simply pays a per-test
 * cost big enough that a loaded runner can push it over.
 *
 * The file qualifies on every count the helper's own docstring requires: it
 * reads the seeded fixture and writes rows it reads straight back, it owns no
 * money path and no concurrency race, and its single `db.transaction` (the
 * roll-call backdating below) is a plain multi-row insert, so becoming a
 * savepoint changes nothing about what it proves.
 */
const ctx = fileScopedShopContext();

describe("today's work queue (in-memory PGlite)", () => {
  it("puts the seeded departure that sails today on the board with live readiness counts", async () => {
    const { db, shop } = ctx;

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);

    expect(work.departures).toHaveLength(1);
    const [departure] = work.departures;
    expect(departure?.title).toBe("Two-Tank Reef — Molasses & French");
    // Nine divers plus the snorkeler and the rider (`seed-mixed-boat.ts`), on
    // a boat two places larger for them.
    expect(departure?.booked).toBe(11);
    expect(departure?.capacity).toBe(14);
    // Most people aboard have already signed their waiver in the fresh seed —
    // only the first-booked diver (the deliberate straggler) is still blocked.
    expect(departure?.ready).toBe(10);
    expect(departure?.blocked).toBe(1);
    expect(departure?.boarded).toBe(0);
    expect(work.nextDeparture).toBeNull();
  });

  it("collapses a boat's identical blockers so one busy trip cannot bury the rest", async () => {
    const { db, shop } = ctx;

    // Today's reef trip is mostly ready these days (only one straggler left);
    // the wreck charter five days out is the boat still carrying a pile of
    // divers who share the same blocker (short of the AOW + Deep + nitrox the
    // charter requires) — exactly the "one busy trip" scenario this collapses.
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const wreck = trips.find((trip) => trip.title === "Wreck Trip — Spiegel Grove");
    if (!wreck) throw new Error("demo wreck trip missing");
    const manifest = await getTripManifest(db, shop.id, wreck.id);
    if (!manifest) throw new Error("expected wreck manifest");
    const wreckBlocked = manifest.divers.filter(
      (diver) => diver.readiness.status !== "ready",
    ).length;

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    // Scoped to the wreck boat: the shop has other trips on the books, and
    // their blockers are their own rows. What must not happen is this boat's
    // blocked divers each claiming a line of the queue.
    const blockerRows = work.actions.filter((action) =>
      action.id.startsWith(`blockers:${wreck.id}:`),
    );

    expect(wreckBlocked).toBeGreaterThan(1);
    expect(blockerRows.length).toBeGreaterThan(0);
    expect(blockerRows.length).toBeLessThan(wreckBlocked);
    expect(new Set(blockerRows.map((action) => action.id)).size).toBe(blockerRows.length);
  });

  it("drops a diver out of the queue once their evidence clears", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const [entry] = await getTripRoster(db, shop.id, reef.id);
    if (!entry) throw new Error("demo booking missing");

    const before = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    // Every reef diver but the seed's first-booked one already has a waiver
    // issued (waiver_pending, collapsed into its own group row); that one
    // diver alone is genuinely unsent, so she gets a named row of her own
    // rather than joining a "N divers" group.
    const waiverRow = (work: Awaited<ReturnType<typeof getTodayWork>>) =>
      work.actions.find((action) => action.id === `blocker:${entry.booking.id}:waiver_not_sent`);
    expect(waiverRow(before)?.subject).toBe(entry.person.fullName);
    expect(waiverRow(before)?.detail).toBe("Waiver not signed, not sent yet.");

    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: entry.booking.id });
    if (!issued.ok) throw new Error("expected a waiver link");
    await completeWaiver(db, issued.token, {
      signerName: entry.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });

    const after = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(waiverRow(after)).toBeUndefined();
    // She was the boat's one remaining straggler — clearing her leaves the
    // whole roster ready.
    expect(after.departures[0]?.ready).toBe(11);
    expect(after.departures[0]?.blocked).toBe(0);
  });

  it("counts a boarded diver on today's board", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const [entry] = await getTripRoster(db, shop.id, reef.id);
    const [staff] = await listStaff(db, shop.id);
    if (!entry || !staff) throw new Error("demo fixture missing");

    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: entry.booking.id });
    if (!issued.ok) throw new Error("expected a waiver link");
    await completeWaiver(db, issued.token, {
      signerName: entry.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: entry.booking.id,
      recordedByPersonId: staff.person.id,
      status: "boarded",
    });

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(work.departures[0]?.boarded).toBe(1);
  });

  /**
   * **The stage pill reads the crew's tap before the clock** (ADR
   * 20261001-logbook, decision 4): a boat the crew says is boarding is Aboard
   * on Today even before its scheduled hour, and the clock speaks otherwise.
   */
  it("gives each departure its phase, the crew's tap first", async () => {
    const { db, shop } = ctx;
    const before = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const departure = before.departures[0];
    if (!departure) throw new Error("demo departure missing");
    expect(departure.phase).not.toBeNull();

    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("demo staff missing");
    const recorded = await recordTripStage(db, {
      shopId: shop.id,
      tripId: departure.tripId,
      stage: "boarding",
      recordedByPersonId: staff.person.id,
      recordedAt: nowDate(),
    });
    expect(recorded.ok).toBe(true);

    const after = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(after.departures.find((row) => row.tripId === departure.tripId)?.phase).toBe("aboard");
  });

  /**
   * **The one first-run question a trading shop can still have open.**
   *
   * `units_confirmed_at` had exactly one reader — the first-run checklist —
   * and that checklist leaves the page at the shop's first departure, which is
   * step 4 of the same checklist. A shop that scheduled a trip before opening
   * the Units row was therefore never asked again, while trading on a currency
   * derived from its timezone at sign-up: a Cozumel shop could be charging
   * cards in dollars having never been asked (issue #835).
   */
  it("keeps asking which currency a shop works in until somebody answers", async () => {
    const { db, shop } = ctx;
    await db.update(shopsTable).set({ unitsConfirmedAt: null }).where(eq(shopsTable.id, shop.id));

    const asking = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const row = asking.actions.find((action) => action.kind === "units_unconfirmed");
    expect(row).toBeDefined();
    // Bottom of the queue and neutral in tone: nothing has gone wrong, and it
    // blocks no departure.
    expect(row?.urgency).toBe("later");
    expect(row?.href).toBe(`/shop/${shop.slug}/settings#units`);
    // It names both derived values, because those *are* the question — the
    // currency a diver's card is charged in and the unit a depth was typed
    // under, not "confirm your units". They lead the row; the detail is the
    // one thing left to do about them.
    expect(row?.subject).toContain(shop.currency.toUpperCase());
    expect(row?.subject).toMatch(/feet|meters/);

    // **Answering it empties the row for good.** The row is derived from the
    // column, not from a dismissal, so there is no state to get stuck.
    await markShopUnitsConfirmed(db, shop.id);
    const answered = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(answered.actions.find((action) => action.kind === "units_unconfirmed")).toBeUndefined();
  });

  /**
   * **Divers alone were never the whole boat** (`docs/product/glossary.md`'s
   * roll-call checkpoint entry).
   *
   * Today's card celebrated on `boarded === booked`, and `boarded` counts
   * bookings — so it threw confetti while the manifest, reading the same
   * departure through `rollCallCompleteness`, correctly refused to close the
   * checkpoint with a named crew member unaccounted for. Two surfaces, one
   * fact, two answers (issue #789).
   *
   * This is that departure: every diver aboard, the divemaster not yet counted.
   */
  /**
   * **The crew line reads the same twice.**
   *
   * The assignments query carried no `orderBy`, so the order was whatever the
   * planner handed back. A visual baseline caught the consequence: the same
   * departure rendered "Keiko Tanaka, Sal Moretti" on one CI run and "Sal
   * Moretti, Keiko Tanaka" on the next, from identical seeded data. Nothing
   * broke; a shop reading its own board twice in a morning simply had to
   * wonder what had changed.
   *
   * **This test does not reproduce that, and cannot.** Which order an
   * unordered read returns is the planner's choice, and locally it happens to
   * come back alphabetical whichever order the rows went in — which is exactly
   * why the bug survived. What it pins is the *contract*: crew comes back
   * sorted by name. The two are assigned in reverse alphabetical order so the
   * assertion still has teeth against an implementation that hands back
   * insertion order, which is the shape the unordered read had on the run that
   * flapped.
   */
  it("lists a departure's crew by name, the same way every time", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const staff = await listStaff(db, shop.id);
    // Two people, assigned in reverse alphabetical order. Insertion order is
    // what an unordered read hands back, so this is the shape that tells the
    // two apart: without the `orderBy` the board reads them Z-then-A.
    const pair = [...staff]
      .sort((a, b) => b.person.fullName.localeCompare(a.person.fullName))
      .slice(0, 2);
    expect(pair).toHaveLength(2);
    await db.delete(tripAssignments).where(eq(tripAssignments.tripId, reef.id));
    for (const member of pair) {
      await db.insert(tripAssignments).values({ tripId: reef.id, personId: member.person.id });
    }

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const departure = work.departures.find((candidate) => candidate.tripId === reef.id);
    if (!departure) throw new Error("the reef departure is not on the board");

    const names = departure.crew.map((member) => member.fullName);
    expect(names).toEqual([...pair.map((member) => member.person.fullName)].sort());
  });

  it("does not call a departure accounted for while its crew is uncounted", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const roster = await getTripRoster(db, shop.id, reef.id);
    const [staff] = await listStaff(db, shop.id);
    if (roster.length === 0 || !staff) throw new Error("demo fixture missing");

    // Every diver signed, then aboard. The waivers are not decoration:
    // `recordRollCall` refuses a diver who is not ready, and the seeded boat
    // has one unsigned — so without them this is a boat with eight of nine
    // aboard, which is not the state under test.
    for (const entry of roster) {
      const issued = await issueWaiverRequest(db, {
        shopId: shop.id,
        bookingId: entry.booking.id,
      });
      // Not every seat needs one — a diver the seed already has signed is
      // refused a second link, and that is the state we want anyway.
      if (!issued.ok) continue;
      await completeWaiver(db, issued.token, {
        signerName: entry.person.fullName,
        agreed: true,
        medicalAnswers: clearAnswers,
      });
    }
    for (const entry of roster) {
      const recorded = await recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: entry.booking.id,
        recordedByPersonId: staff.person.id,
        status: "boarded",
      });
      expect(recorded).toMatchObject({ ok: true });
    }

    const before = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const uncounted = before.departures.find((row) => row.tripId === reef.id);
    if (!uncounted) throw new Error("reef departure missing from today’s board");
    // The condition the card used to celebrate on, still true — which is the
    // point: nothing about the diver half changed, and it was never enough.
    expect(uncounted.boarded).toBe(uncounted.booked);
    expect(uncounted.blocked).toBe(0);
    expect(uncounted.crew.length).toBeGreaterThan(0);
    expect(uncounted.crewAccountedFor).toBe(false);
    expect(uncounted.crewReason).toBe("crew_awaiting");
    // And it is the manifest's own verdict, not a second rule: the manifest
    // reading the same departure refuses to close the checkpoint too.
    const manifest = await getTripManifest(db, shop.id, reef.id);
    expect(manifest?.completeness.complete).toBe(false);

    for (const member of uncounted.crew) {
      await recordCrewRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        personId: member.id,
        recordedByPersonId: staff.person.id,
        status: "boarded",
      });
    }

    const after = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const counted = after.departures.find((row) => row.tripId === reef.id);
    expect(counted?.crewAccountedFor).toBe(true);
    expect(counted?.crewReason).toBeNull();
    expect((await getTripManifest(db, shop.id, reef.id))?.completeness.complete).toBe(true);
  });

  /**
   * **The counts line is right; the sentence was not.** `blocked` is readiness
   * over the whole roster and stays that. What was missing is which of those
   * divers the card's sentence can still be about, so it stopped claiming a
   * gate stands in front of someone already on the boat (issue #698).
   */
  it("splits the blocked count into those aboard and those still ashore", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const roster = await listTripReadiness(db, shop.id, reef.id);
    const [staff] = await listStaff(db, shop.id);
    const blockedEntry = roster.find((row) => row.readiness.status === "blocked");
    if (!blockedEntry || !staff) throw new Error("demo fixture missing a blocked diver");

    const before = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const departure = before.departures.find((row) => row.tripId === reef.id);
    if (!departure) throw new Error("reef departure missing from today’s board");
    // Nobody aboard yet: every blocked diver is genuinely still ashore, which
    // is the state the original sentence was written for and must not change.
    expect(departure.blockedAboard).toBe(0);
    expect(departure.blockedAshore).toBe(departure.blocked);

    // Board one of them. Readiness gates the departure checkpoint, so this
    // takes a signed waiver first — and the diver stays `blocked` on some other
    // count, which is exactly the case: a blocked diver may be aboard.
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: blockedEntry.booking.id,
    });
    if (!issued.ok) throw new Error("expected a waiver link");
    await completeWaiver(db, issued.token, {
      signerName: blockedEntry.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: blockedEntry.booking.id,
      recordedByPersonId: staff.person.id,
      status: "boarded",
    });

    const after = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const boardedDeparture = after.departures.find((row) => row.tripId === reef.id);
    if (!boardedDeparture) throw new Error("reef departure missing after roll call");
    // Either the waiver was this diver's only blocker (they are now ready, and
    // the blocked total drops) or it was not (they are aboard *and* blocked).
    // Both are legitimate; what must never happen is a blocked diver aboard
    // still being counted as one who cannot board yet.
    expect(boardedDeparture.blockedAboard + boardedDeparture.blockedAshore).toBe(
      boardedDeparture.blocked,
    );
    expect(boardedDeparture.blockedAshore).toBeLessThan(departure.blockedAshore);
  });

  /**
   * A diver the crew marked `not_boarded` at departure never left the dock —
   * but **only once the boat has actually gone.**
   *
   * The control says "Mark not boarded", and at 07:05 on a 07:30 boat that
   * reads as "isn't aboard yet", not "isn't coming". Dropping them from the
   * card on the tap alone took the prompt off the front desk 25 minutes before
   * it stopped being fixable (`dive-domain-expert`, after #698 shipped). This
   * asserts both sides of the hour-long departure buffer, which is what the
   * original version of this test missed: it drove an *upcoming* trip while its
   * own docstring said "a boat that has sailed without them".
   */
  it("keeps a not-boarded diver's blocker on the card until the boat has gone", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const roster = await listTripReadiness(db, shop.id, reef.id);
    const [staff] = await listStaff(db, shop.id);
    const blockedEntry = roster.find((row) => row.readiness.status === "blocked");
    if (!blockedEntry || !staff) throw new Error("demo fixture missing a blocked diver");

    const before = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const wasDeparture = before.departures.find((row) => row.tripId === reef.id);
    if (!wasDeparture) throw new Error("reef departure missing from today’s board");
    expect(wasDeparture.blockedAshore).toBeGreaterThan(0);

    await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: blockedEntry.booking.id,
      recordedByPersonId: staff.person.id,
      status: "not_boarded",
    });

    // Still at the dock: the blocker stays on the card, because a diver marked
    // not boarded before the lines are off is still someone the desk can chase.
    const atDock = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const stillHere = atDock.departures.find((row) => row.tripId === reef.id);
    if (!stillHere) throw new Error("reef departure missing after roll call");
    expect(stillHere.blockedAshore).toBe(wasDeparture.blockedAshore);

    expect(stillHere.blockedAboard).toBe(0);
    // Still on the roster, still blocked — the counts line is unchanged.
    expect(stillHere.blocked).toBe(wasDeparture.blocked);

    // **And an hour past departure the card is gone entirely**, which is the
    // part worth pinning: the board's own window ends at the same buffer the
    // rule above uses, so "the boat has sailed" is a state this surface never
    // renders. The gate stays because it states the rule correctly for whoever
    // widens that window — but nobody should go looking for the silenced case
    // on this card, because there isn't one.
    const sailed = new Date(reef.startsAt.getTime() + 61 * 60 * 1000);
    const after = await getTodayWork(db, shop.id, shop.slug, shop.timezone, sailed);
    expect(after.departures.find((row) => row.tripId === reef.id)).toBeUndefined();
  });

  it("drops a canceled booking from the boarded count, not just the booked count", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const [entry] = await getTripRoster(db, shop.id, reef.id);
    const [staff] = await listStaff(db, shop.id);
    if (!entry || !staff) throw new Error("demo fixture missing");

    // Readiness gates boarding at the departure checkpoint, so this diver
    // needs a completed waiver before recordRollCall will accept "boarded"
    // (same setup as the "counts a boarded diver" test above).
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: entry.booking.id });
    if (!issued.ok) throw new Error("expected a waiver link");
    await completeWaiver(db, issued.token, {
      signerName: entry.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: entry.booking.id,
      recordedByPersonId: staff.person.id,
      status: "boarded",
    });
    const boarded = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(boarded.departures[0]?.booked).toBe(11);
    expect(boarded.departures[0]?.boarded).toBe(1);

    // A no-show pulled, or a refund, after the diver already boarded — the
    // roll-call event row stays in the table. Without the bookings join in
    // boardedCountsByTrip, this diver would still count as boarded even
    // though `booked` (upcomingTripsWithCounts) already excludes them —
    // letting the two totals coincidentally match while other divers on this
    // trip remain genuinely unboarded.
    await cancelBooking(db, shop.id, entry.booking.id);
    const afterCancel = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(afterCancel.departures[0]?.booked).toBe(10);
    expect(afterCancel.departures[0]?.boarded).toBe(0);
  });

  /**
   * A fit is counted **per item**, not per row (glossary — *Complete rental
   * fit*): a diver counts as missing a fit when any piece they take from the
   * shop has no size against it. This test used to save a fit with a BCD size
   * and nothing else and assert the row cleared — which is precisely the bug
   * the widening fixes, so the "cleared" half now has to supply every size.
   */
  it("flags divers whose rental sizes are missing, and clears it once every size is on file", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const roster = await getTripRoster(db, shop.id, reef.id);
    if (roster.length === 0) throw new Error("demo bookings missing");

    const flagged = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const prepAction = flagged.actions.find((action) => action.id === `prep:${reef.id}`);
    expect(prepAction?.actionLabel).toBe("Open prep list");
    // The packing list reads on the departure now (ADR 20260919-one-idea,
    // slice 23c), so the day's row lands on its section rather than on a
    // route no staffer navigates to.
    expect(prepAction?.href).toBe(`/shop/${shop.slug}/trips/${reef.id}/prep#packing-list`);

    const rents = {
      rentsBcd: true,
      rentsRegulator: true,
      rentsWetsuit: true,
      rentsMaskFins: true,
      rentsWeights: true,
      rentsDiveComputer: false,
      rentsGopro: false,
      rentsDrysuit: false,
      rentsHood: false,
      rentsGloves: false,
      rentsTorch: false,
      rentsSmb: false,
    };

    // A BCD size and nothing else: this is what the old rule called a fit, and
    // the packer would still have had no wetsuit, boot, fin or weight number
    // to load from. The row must stay.
    for (const entry of roster) {
      await saveRentalFit(db, {
        shopId: shop.id,
        personId: entry.person.id,
        ...rents,
        bcdSize: "M",
      });
    }
    const stillPartial = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(stillPartial.actions.some((action) => action.id === `prep:${reef.id}`)).toBe(true);

    for (const entry of roster) {
      await saveRentalFit(db, {
        shopId: shop.id,
        personId: entry.person.id,
        ...rents,
        bcdSize: "M",
        wetsuitSize: "3 mm / M",
        bootSize: "9",
        finSize: "9",
        weightPreference: "12 lbs",
      });
    }

    const cleared = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(cleared.actions.some((action) => action.id === `prep:${reef.id}`)).toBe(false);
  });

  it("turns an email-delivery failure into a one-tap resend, not just a link", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const [entry] = await getTripRoster(db, shop.id, reef.id);
    if (!entry) throw new Error("demo bookings missing");

    // A failed booking confirmation resends from stored data...
    await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId: entry.booking.id,
      kind: "booking_confirmation",
      delivery: { status: "failed" },
    });
    const withConfirm = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const confirmRow = withConfirm.actions.find((action) => action.kind === "email_delivery");
    expect(confirmRow?.actionLabel).toBe("Resend confirmation");
    expect(confirmRow?.resend).toEqual({ bookingIds: [entry.booking.id] });

    // ...while a failed waiver link reissues through the shared WP-1 send path.
    await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId: entry.booking.id,
      kind: "waiver_request",
      delivery: { status: "failed" },
    });
    const withWaiver = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const waiverRow = withWaiver.actions.find(
      (action) => action.kind === "email_delivery" && action.waiver,
    );
    expect(waiverRow?.actionLabel).toBe("Resend waiver link");
    expect(waiverRow?.waiver).toEqual({ bookingIds: [entry.booking.id] });
  });

  it("makes a freed seat one-tap invitable, targeting the front of the wait list", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id);
    // The seeded reef boat sails today at 9/12 — three open seats to fill.
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    expect(reef.booked).toBeLessThan(reef.capacity);

    const [front, later] = await db
      .insert(people)
      .values([
        { shopId: shop.id, fullName: "Marina Reyes", email: "marina@example.com" },
        { shopId: shop.id, fullName: "Theo Park", email: "theo@example.com" },
      ])
      .returning();
    if (!front || !later) throw new Error("could not seed waiters");
    // Explicit join times so the front of the line is deterministic.
    await db.insert(tripWaitlistEntries).values([
      {
        shopId: shop.id,
        tripId: reef.id,
        personId: front.id,
        createdAt: new Date("2020-01-01T00:00:00.000Z"),
      },
      {
        shopId: shop.id,
        tripId: reef.id,
        personId: later.id,
        createdAt: new Date("2020-02-01T00:00:00.000Z"),
      },
    ]);
    const frontEntry = (
      await db
        .select()
        .from(tripWaitlistEntries)
        .where(
          and(eq(tripWaitlistEntries.tripId, reef.id), eq(tripWaitlistEntries.personId, front.id)),
        )
    )[0];
    if (!frontEntry) throw new Error("front entry missing");

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const row = work.actions.find((action) => action.id === `waitlist:${reef.id}`);
    expect(row?.kind).toBe("waitlist_seat");
    // Depth is counted, but the invite targets the earliest joiner specifically.
    expect(row?.detail).toContain("2 on the wait list");
    expect(row?.invite).toBeDefined();
    expect(row?.invite?.entryId).toBe(frontEntry.id);
    expect(row?.invite?.personName).toBe("Marina Reyes");
    expect(row?.invite?.personEmail).toBe("marina@example.com");
    expect(row?.invite?.tripId).toBe(reef.id);
    expect(row?.invite?.bookingPath).toBe(`/s/${shop.slug}/trips/${reef.id}`);
  });

  it("nudges an under-capacity trip departing soon that has never had a last-minute deal sent", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");

    // Somebody to send the deal to. A diver who states no dates is around for
    // every departure — without one on the list the row is correctly absent
    // (the test below), so this is the row's premise, not scenery.
    await joinLastMinuteList(db, {
      shopId: shop.id,
      fullName: "Nora Quinn",
      email: "nora@example.com",
      declaration: { level: "open_water" as const, noCertification: false, nitrox: false },
    });

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const row = work.actions.find((action) => action.id === `last-minute-fill:${reef.id}`);
    expect(row?.kind).toBe("last_minute_fill");
    expect(row?.detail).toContain(`${reef.capacity - reef.booked} seats open`);
  });

  it("does not nudge to fill seats when nobody on the last-minute list is around for that date", async () => {
    // The row's whole job is "send a deal to the people waiting for one." With
    // nobody reachable there is nothing to send, the trip's Guests tab hides
    // the panel outright, and the row's own `#last-minute-deal` anchor would
    // land on nothing.
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");

    // On the list, but stating a window months after this departure — the
    // sharper case than an empty list, because the entry exists and still must
    // not count.
    const nextYear = new Date(nowMs() + 300 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await joinLastMinuteList(db, {
      shopId: shop.id,
      fullName: "Nora Quinn",
      email: "nora@example.com",
      availableFrom: nextYear,
      declaration: { level: "open_water" as const, noCertification: false, nitrox: false },
    });

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(
      work.actions.find((action) => action.id === `last-minute-fill:${reef.id}`),
    ).toBeUndefined();
  });

  it("stops nudging once a last-minute deal has actually been sent for that trip", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");

    await upsertShopStripeAccount(db, shop.id, "acct_today_test");
    await setShopStripeAccountStatus(db, "acct_today_test", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    await joinLastMinuteList(db, {
      shopId: shop.id,
      fullName: "Nora Quinn",
      email: "nora@example.com",
      declaration: { level: "open_water" as const, noCertification: false, nitrox: false },
    });
    const sent = await sendLastMinuteDealBlast(
      db,
      { shopId: shop.id, shopSlug: shop.slug, tripId: reef.id, discountPercent: 25 },
      fakePromotions(),
    );
    expect(sent.ok).toBe(true);

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(
      work.actions.find((action) => action.id === `last-minute-fill:${reef.id}`),
    ).toBeUndefined();
  });

  it("raises a nitrox request whose card stopped being verified", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const roster = await getTripRoster(db, shop.id, reef.id);
    const certified = roster.find((entry) => entry.person.fullName === "Priya Sharma");
    if (!certified) throw new Error("seeded nitrox diver missing from the reef trip");

    const requested = await setBookingNitrox(db, {
      shopId: shop.id,
      bookingId: certified.booking.id,
      wantsNitrox: true,
    });
    expect(requested.ok).toBe(true);

    const before = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(before.actions.some((action) => action.id === `nitrox:${reef.id}`)).toBe(false);

    // The card is pulled (archived) after the request was already accepted.
    await db
      .update(nitroxCertifications)
      .set({ deletedAt: nowDate() })
      .where(
        and(
          eq(nitroxCertifications.shopId, shop.id),
          eq(nitroxCertifications.personId, certified.person.id),
        ),
      );

    const after = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const nitroxAction = after.actions.find((action) => action.id === `nitrox:${reef.id}`);
    // One diver is a row about that person, by name, never "1 diver wants…".
    expect(nitroxAction?.subject).toBe("Priya Sharma");
    expect(nitroxAction?.detail).toBe("Wants nitrox, no verified card.");
  });

  it("nudges staff about missing emergency contacts on a near boat, and clears once filled", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const roster = await getTripRoster(db, shop.id, reef.id);
    if (roster.length === 0) throw new Error("demo bookings missing");
    // Strip any seeded contacts so today's whole boat is missing one.
    for (const entry of roster) {
      await db
        .update(people)
        .set({ emergencyContactName: null, emergencyContactPhone: null })
        .where(eq(people.id, entry.person.id));
    }

    const flagged = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const contactAction = flagged.actions.find((action) => action.id === `contact:${reef.id}`);
    expect(contactAction?.kind).toBe("emergency_contact");
    expect(contactAction?.detail).toContain("no emergency contact");
    // Never a boarding blocker; it points at the guests roster to settle at the counter.
    expect(contactAction?.href).toBe(`/shop/${shop.slug}/trips/${reef.id}`);

    // A name with no phone is unreachable in an incident — still flagged.
    for (const entry of roster) {
      await db
        .update(people)
        .set({ emergencyContactName: "Kin Ashford", emergencyContactPhone: null })
        .where(eq(people.id, entry.person.id));
    }
    const nameOnly = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(nameOnly.actions.some((action) => action.id === `contact:${reef.id}`)).toBe(true);

    // A contact is only "on file" with a reachable number, so fill both.
    for (const entry of roster) {
      await db
        .update(people)
        .set({ emergencyContactName: "Kin Ashford", emergencyContactPhone: "+1 305 555 0175" })
        .where(eq(people.id, entry.person.id));
    }
    const cleared = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(cleared.actions.some((action) => action.id === `contact:${reef.id}`)).toBe(false);
  });

  it("never looks past its one-week horizon", async () => {
    const { db, shop } = ctx;

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const horizon = nowMs() + 7 * 24 * 60 * 60 * 1000;

    for (const action of work.actions) {
      expect(action.dueAt?.getTime() ?? 0).toBeLessThanOrEqual(horizon);
    }
  });

  it("points every action at a route inside this shop", async () => {
    const { db, shop } = ctx;

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);

    expect(work.actions.length).toBeGreaterThan(0);
    for (const action of work.actions) {
      expect(action.href.startsWith(`/shop/${shop.slug}/`)).toBe(true);
      expect(action.actionLabel).toBeTruthy();
      // A row's words are its subject plus, where it has one, its detail: the
      // desk's two counting rows ("3 messages are waiting on an answer") are
      // their subject alone, so an empty detail is a state rather than a gap
      // (`TodayAction.detail`, src/lib/today.ts).
      expect(action.subject).toBeTruthy();
    }
  });
});

/**
 * DOM-M3. Today, the staffing coverage list, the trip page, and the booking
 * gate all ask "is this course session staffed", and all four used to answer
 * it from shop-wide roles alone — so an instructor rostered as this trip's
 * deck hand cleared `instructor_missing` on his own. Two safety surfaces
 * disagreeing is worse than either being wrong alone, so this asserts the
 * agreement directly: one definition (`countInWaterCrew`, src/lib/crew-roles.ts).
 */
describe("Today and the staffing view count crew the same way (DOM-M3)", () => {
  async function courseSessionToday() {
    const { db, shop } = ctx;
    const [course] = await db
      .select()
      .from(courses)
      .where(and(eq(courses.shopId, shop.id), eq(courses.title, "Open Water Diver")));
    const staff = await listStaff(db, shop.id);
    const instructor = staff.find((entry) => entry.roles.includes("instructor"));
    if (!course || !instructor) throw new Error("seeded fixture missing");
    const startsAt = new Date(nowMs() + 3 * 60 * 60 * 1000);
    const trip = await createTrip(db, {
      shopId: shop.id,
      courseId: course.id,
      title: "Per-trip role session",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
      capacity: 8,
      plannedDives: 2,
    });
    if (!trip) throw new Error("failed to create course trip");
    // Inserted directly rather than through `setTripCrew`: the seeded
    // instructor already crews a boat in this window, and the overlap refusal
    // is not what this test is about.
    await db.insert(tripAssignments).values({ tripId: trip.id, personId: instructor.person.id });
    return { db, shop, trip, instructorId: instructor.person.id };
  }

  /**
   * Today's verdict on this one session, and the roster's window-wide
   * needs-crew count taken alongside it. The roster no longer names a
   * per-trip gap — its whole crewing surface is that count — so agreement is
   * asserted as a delta: when Today flags the session, exactly one more
   * departure in the window needs crew.
   */
  async function readBoth(
    db: Awaited<ReturnType<typeof courseSessionToday>>["db"],
    shop: Awaited<ReturnType<typeof courseSessionToday>>["shop"],
    trip: { id: string; startsAt: Date; endsAt: Date },
  ) {
    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const view = await getStaffingView(
      db,
      shop.id,
      new Date(trip.startsAt.getTime() - 60 * 60 * 1000),
      new Date(trip.endsAt.getTime() + 60 * 60 * 1000),
    );
    return {
      today: work.actions.some(
        (action) => action.kind === "instructor_missing" && action.id === `instructor:${trip.id}`,
      ),
      needCrew: view.crewGaps.needCrew,
    };
  }

  it("agrees that a rostered deck hand does not staff the session, and that the instructor does", async () => {
    const { db, shop, trip, instructorId } = await courseSessionToday();
    // No per-trip role: the status quo, and both surfaces say it is staffed.
    const staffed = await readBoth(db, shop, trip);
    expect(staffed.today).toBe(false);

    await db
      .update(tripAssignments)
      .set({ tripRole: "crew" })
      .where(and(eq(tripAssignments.tripId, trip.id), eq(tripAssignments.personId, instructorId)));
    const asDeckHand = await readBoth(db, shop, trip);
    expect(asDeckHand.today).toBe(true);
    // The agreement itself: Today flagged one more session, and the roster's
    // count rose by exactly one.
    expect(asDeckHand.needCrew).toBe(staffed.needCrew + 1);

    await db
      .update(tripAssignments)
      .set({ tripRole: "instructor" })
      .where(and(eq(tripAssignments.tripId, trip.id), eq(tripAssignments.personId, instructorId)));
    const asInstructor = await readBoth(db, shop, trip);
    expect(asInstructor.today).toBe(false);
    expect(asInstructor.needCrew).toBe(staffed.needCrew);
  });
});

/**
 * Issue #732. `divemasterRatioGap` (src/lib/divemaster-ratio.ts) "applies to
 * every dive the shop runs, fun dives and course sessions alike", but before
 * this it reached Today nowhere — a fun dive with divers booked and nobody
 * rostered raised no row at all, while a missing rental size did. These
 * assert both new rows, and that the boundary with `instructor_missing`
 * (agency ratios, course-only) stays exactly where it was.
 */
describe("uncrewed and below-target departures (issue #732)", () => {
  async function reefTrip(db: ReturnType<typeof fileScopedShopContext>["db"], shopId: string) {
    const trips = await upcomingTripsWithCounts(db, shopId);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    return reef;
  }

  /**
   * The reef trip with both of its crew still aboard and neither in the water:
   * the captain on the lines and the divemaster driving (tripRole "crew" and
   * "captain", the DOM-M3 shape). Neither counts toward the in-water ratio
   * (src/lib/crew-roles.ts), so the trip is uncrewed by the rule the ratio
   * itself uses. The seed used to roster today's reef boat this way; it no
   * longer does (UX audit 2026-10-07, item 4), so each case says it here.
   */
  async function uncrewedReefTrip(
    db: ReturnType<typeof fileScopedShopContext>["db"],
    shopId: string,
  ) {
    const reef = await reefTrip(db, shopId);
    const crew = await db
      .select({ personId: tripAssignments.personId, role: personRolesTable.role })
      .from(tripAssignments)
      .innerJoin(personRolesTable, eq(personRolesTable.personId, tripAssignments.personId))
      .where(eq(tripAssignments.tripId, reef.id));
    expect(crew.length).toBeGreaterThan(0);
    for (const member of crew) {
      await db
        .update(tripAssignments)
        .set({ tripRole: member.role === "divemaster" ? "captain" : "crew" })
        .where(
          and(eq(tripAssignments.tripId, reef.id), eq(tripAssignments.personId, member.personId)),
        );
    }
    return reef;
  }

  it("raises uncrewed_departure for a fun dive with divers booked and zero in-water crew", async () => {
    const { db, shop } = ctx;
    const reef = await uncrewedReefTrip(db, shop.id);

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);

    const row = work.actions.find((action) => action.id === `uncrewed:${reef.id}`);
    expect(row?.kind).toBe("uncrewed_departure");
    // Divers only: the snorkeler and the rider aboard (`seed-mixed-boat.ts`)
    // are in the headcount, not the ratio.
    expect(reef.bookedDivers).toBeLessThan(reef.booked);
    expect(row?.detail).toBe(`${reef.bookedDivers} divers booked, no divemaster or instructor.`);
    // The boundary this ticket must not blur: instructor_missing is an
    // agency training ratio and only ever fires for a course session. This
    // trip carries no course.
    expect(work.actions.some((action) => action.id === `instructor:${reef.id}`)).toBe(false);
  });

  it("raises no crew row at all for a shop that keeps no crew schedule", async () => {
    // `shopCrewTarget` (src/lib/crew-schedule.ts) hands the queue a null
    // target when `shops.crew_schedule_enabled` is off: the same uncrewed reef
    // trip as above, and nothing about its crew.
    const { db, shop } = ctx;
    const reef = await reefTrip(db, shop.id);

    const work = await getTodayWork(
      db,
      shop.id,
      shop.slug,
      shop.timezone,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      null,
    );

    const crewRows = work.actions.filter(
      (action) =>
        action.id === `uncrewed:${reef.id}` ||
        action.id === `crew-target:${reef.id}` ||
        action.id === `instructor:${reef.id}`,
    );
    expect(crewRows).toEqual([]);
  });

  it("raises the quieter crew_below_target once some crew is rostered, not uncrewed_departure", async () => {
    const { db, shop } = ctx;
    const reef = await reefTrip(db, shop.id);
    const staff = await listStaff(db, shop.id);
    const divemaster = staff.find(
      (entry) => entry.roles.includes("divemaster") && !entry.roles.includes("instructor"),
    );
    if (!divemaster) throw new Error("seeded fixture missing a divemaster");
    await setTripCrew(db, shop.id, reef.id, [
      { personId: divemaster.person.id, tripRole: "divemaster" },
    ]);

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);

    expect(work.actions.some((action) => action.id === `uncrewed:${reef.id}`)).toBe(false);
    const row = work.actions.find((action) => action.id === `crew-target:${reef.id}`);
    expect(row?.kind).toBe("crew_below_target");
    expect(row?.detail).toBe(`${reef.bookedDivers} divers, 1 supervisor. Your target is 6:1.`);
  });

  it("clears both rows once the departure meets its own target", async () => {
    const { db, shop } = ctx;
    const reef = await reefTrip(db, shop.id);
    // The demo's own default divers-per-divemaster is 6, and this trip books
    // 9 — two divemasters clears ceil(9/6).
    const staff = await listStaff(db, shop.id);
    const inWaterQualified = staff.filter(
      (entry) => entry.roles.includes("divemaster") || entry.roles.includes("instructor"),
    );
    expect(inWaterQualified.length).toBeGreaterThanOrEqual(2);
    await setTripCrew(
      db,
      shop.id,
      reef.id,
      inWaterQualified
        .slice(0, 2)
        .map((entry) => ({ personId: entry.person.id, tripRole: "divemaster" as const })),
    );

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);

    expect(
      work.actions.some(
        (action) => action.id === `uncrewed:${reef.id}` || action.id === `crew-target:${reef.id}`,
      ),
    ).toBe(false);
  });

  it("never raises either row for an empty boat", async () => {
    const { db, shop } = ctx;
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Empty afternoon dive",
      startsAt: new Date(nowMs() + 26 * 60 * 60 * 1000),
      endsAt: new Date(nowMs() + 28 * 60 * 60 * 1000),
      capacity: 6,
      plannedDives: 2,
    });
    if (!trip) throw new Error("failed to create trip");

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);

    expect(
      work.actions.some(
        (action) => action.id === `uncrewed:${trip.id}` || action.id === `crew-target:${trip.id}`,
      ),
    ).toBe(false);
  });

  /**
   * The crew-gap rows one departure raised, in the order Today ranked them.
   *
   * Three ids, because #732's rule is about these three and nothing else: a
   * departure legitimately carries `dive_prep`, waiver and payment rows beside
   * whichever of these fires.
   */
  function crewGapKindsFor(work: { actions: { id: string; kind: string }[] }, tripId: string) {
    const ids = [`instructor:${tripId}`, `uncrewed:${tripId}`, `crew-target:${tripId}`];
    return work.actions.filter((action) => ids.includes(action.id)).map((action) => action.kind);
  }

  /**
   * **One row per departure, and which one wins when both rules hold.**
   *
   * A course session with divers aboard and nobody in the water satisfies
   * `courseCrewGap` and `divemasterRatioGap` at once. Issue #732 established
   * that it gets one row, never two — two rows naming one gap in two
   * vocabularies is the wallpaper failure `KIND_SEVERITY`'s own comments
   * design against — and this fixture is the shape that produces it: an
   * instructor rostered, the session books out, and the instructor is then
   * reassigned to `crew`, which contributes nothing in the water
   * (`inWaterCrewRole`, src/lib/crew-roles.ts).
   *
   * The row it gets is `uncrewed_departure`, not `instructor_missing`, as of
   * issue #1338. #732's rule is about the *count*, and the count is unchanged;
   * what moved is that `instructor_missing`'s sentence mentions no divemaster,
   * so a manager reading it on an empty boat concludes one is already aboard
   * and only the instructor is outstanding. The bigger fact goes first, and
   * the Crew panel one tap away holds the detail.
   */
  it("places the one row that says both, for a course session with nobody in the water", async () => {
    const { db, shop } = ctx;
    const [course] = await db
      .select()
      .from(courses)
      .where(and(eq(courses.shopId, shop.id), eq(courses.title, "Open Water Diver")));
    const staff = await listStaff(db, shop.id);
    const instructor = staff.find((entry) => entry.roles.includes("instructor"));
    if (!course || !instructor) throw new Error("seeded fixture missing");
    const startsAt = new Date(nowMs() + 3 * 60 * 60 * 1000);
    const trip = await createTrip(db, {
      shopId: shop.id,
      courseId: course.id,
      title: "Instructor reassigned Open Water session",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
      capacity: 8,
      plannedDives: 2,
    });
    if (!trip) throw new Error("failed to create course trip");
    // Rostered (no per-trip role, so shop-wide inference staffs it) before the
    // booking gate runs — the same shape as the DOM-M3 fixture above, and the
    // realistic way this scenario actually arises: a session books out while
    // staffed, and the instructor is reassigned to something else afterward
    // (the booking gate only checks at booking time, never continuously).
    await db.insert(tripAssignments).values({ tripId: trip.id, personId: instructor.person.id });
    const party = await createBookingParty(db, [
      {
        actor: "staff" as const,
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Uncrewed Course Diver",
        email: "uncrewed-course-diver@example.com",
      },
    ]);
    if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
    await db
      .update(tripAssignments)
      .set({ tripRole: "crew" })
      .where(
        and(
          eq(tripAssignments.tripId, trip.id),
          eq(tripAssignments.personId, instructor.person.id),
        ),
      );

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);

    // Exactly one *crew-gap* row for this departure — #732's rule, asserted
    // over all three ids rather than as the absence of the two the old
    // assertion happened to name. Other kinds (`dive_prep` and friends) fire
    // for the same departure and are not what that rule is about.
    expect(crewGapKindsFor(work, trip.id)).toEqual(["uncrewed_course"]);

    // **The crew schedule switch never hides a course's instructor gap.** A
    // shop that keeps no roster (a null target, `shopCrewTarget`) loses the
    // divemaster half of the sentence and keeps the half the agency ratio
    // refuses seats on.
    const noRoster = await getTodayWork(
      db,
      shop.id,
      shop.slug,
      shop.timezone,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      null,
    );
    expect(crewGapKindsFor(noRoster, trip.id)).toEqual(["instructor_missing"]);
  });

  /**
   * The boundary the test above used to hold, restated where it is actually
   * about a boundary: a course session **with** somebody in the water and no
   * instructor. "No crew" is false here, so `instructor_missing` is both the
   * true row and the more precise one — it cites the agency ratio a seat is
   * refused against — and `crew_below_target` must still not fire beside it.
   */
  it("keeps the instructor row, and only it, once a divemaster is in the water", async () => {
    const { db, shop } = ctx;
    const [course] = await db
      .select()
      .from(courses)
      .where(and(eq(courses.shopId, shop.id), eq(courses.title, "Open Water Diver")));
    const staff = await listStaff(db, shop.id);
    const instructor = staff.find((entry) => entry.roles.includes("instructor"));
    if (!course || !instructor) throw new Error("seeded fixture missing");
    const startsAt = new Date(nowMs() + 3 * 60 * 60 * 1000);
    const trip = await createTrip(db, {
      shopId: shop.id,
      courseId: course.id,
      title: "Divemaster-only Open Water session",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
      capacity: 8,
      plannedDives: 2,
    });
    if (!trip) throw new Error("failed to create course trip");
    // Same shape as the fixture above, one role apart: rostered before the
    // booking gate runs (which refuses a course session with no instructor —
    // `course_unstaffed`), then reassigned afterwards. `divemaster` rather
    // than `crew`, so the same person now counts as a certified assistant in
    // the water and the session is short an instructor without being empty
    // (`inWaterCrewRole`, src/lib/crew-roles.ts).
    await db.insert(tripAssignments).values({ tripId: trip.id, personId: instructor.person.id });
    const party = await createBookingParty(db, [
      {
        actor: "staff" as const,
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Divemaster Only Diver",
        email: "divemaster-only-diver@example.com",
      },
    ]);
    if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
    await db
      .update(tripAssignments)
      .set({ tripRole: "divemaster" })
      .where(
        and(
          eq(tripAssignments.tripId, trip.id),
          eq(tripAssignments.personId, instructor.person.id),
        ),
      );

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);

    expect(crewGapKindsFor(work, trip.id)).toEqual(["instructor_missing"]);
  });

  /**
   * **A shop whose ordinary product is an unguided buddy-pair dive can say so,
   * once, per departure** (issue #973).
   *
   * The row above is warning-toned and sits near the top of Today. Without a
   * way to mark a departure self-guided, a shop that runs self-guided charters
   * would see it on every sailing forever, with no way to silence it short of
   * rostering a divemaster it did not want — which is the habituation ADR
   * 20260820-shop-divemaster-ratio was written to avoid, arriving as "staff
   * learn to skip this row" rather than as a refusal.
   */
  it("raises neither row for a departure the shop marked self-guided", async () => {
    const { db, shop } = ctx;
    const reef = await uncrewedReefTrip(db, shop.id);
    // The same trip the first test in this block proves *does* raise the row,
    // so the only thing that changed is the mark.
    const before = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(before.actions.some((action) => action.id === `uncrewed:${reef.id}`)).toBe(true);

    await db.update(tripsTable).set({ selfGuided: true }).where(eq(tripsTable.id, reef.id));

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(
      work.actions.some(
        (action) => action.id === `uncrewed:${reef.id}` || action.id === `crew-target:${reef.id}`,
      ),
    ).toBe(false);
  });

  /**
   * The boundary the mark must never cross. An agency training ratio is a
   * safety cap that really does refuse a seat (`src/lib/course-ratios.ts`), and
   * no shop may switch one off by ticking a box on the departure.
   */
  it("still flags a course session's missing instructor when the departure is self-guided", async () => {
    const { db, shop } = ctx;
    const [course] = await db
      .select()
      .from(courses)
      .where(and(eq(courses.shopId, shop.id), eq(courses.title, "Open Water Diver")));
    if (!course) throw new Error("seeded course missing");
    const startsAt = new Date(nowMs() + 3 * 60 * 60 * 1000);
    const trip = await createTrip(db, {
      shopId: shop.id,
      courseId: course.id,
      title: "Self-guided marked Open Water session",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
      capacity: 8,
      plannedDives: 2,
    });
    if (!trip) throw new Error("failed to create course trip");
    const staff = await listStaff(db, shop.id);
    const instructor = staff.find((entry) => entry.roles.includes("instructor"));
    if (!instructor) throw new Error("seeded instructor missing");
    // Staffed at booking time, then reassigned — the same shape as the
    // double-fire test above, and the realistic way the gap actually arises.
    await db.insert(tripAssignments).values({ tripId: trip.id, personId: instructor.person.id });
    const party = await createBookingParty(db, [
      {
        actor: "staff" as const,
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Self Guided Course Diver",
        email: "self-guided-course-diver@example.com",
      },
    ]);
    if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
    await db
      .update(tripAssignments)
      .set({ tripRole: "crew" })
      .where(
        and(
          eq(tripAssignments.tripId, trip.id),
          eq(tripAssignments.personId, instructor.person.id),
        ),
      );
    await db.update(tripsTable).set({ selfGuided: true }).where(eq(tripsTable.id, trip.id));

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(work.actions.some((action) => action.id === `instructor:${trip.id}`)).toBe(true);
  });
});

describe("role lens raw material", () => {
  it("marks the trips a captain crews and the sessions an instructor teaches", async () => {
    const { db, shop } = ctx;
    const staff = await listStaff(db, shop.id);
    const captain = staff.find((entry) => entry.roles.includes("captain"))?.person;
    const instructor = staff.find((entry) => entry.roles.includes("instructor"))?.person;
    if (!captain || !instructor) throw new Error("seed staff missing");

    const forCaptain = await getTodayWork(
      db,
      shop.id,
      shop.slug,
      shop.timezone,
      undefined,
      captain.id,
    );
    // The seed assigns the captain to every charter, so today's boat is theirs.
    for (const departure of forCaptain.departures.filter((d) => !d.courseTitle)) {
      expect(forCaptain.crewedTripIds).toContain(departure.tripId);
    }
    // The seed puts the captain on a course session too — a training boat still
    // needs somebody driving it, and a session with exactly one person aboard
    // was the thing worth fixing. `crewedSessions` is "sessions you crew", so
    // it names that one; what keeps "Your sessions" off a captain's Today is
    // the *lens* their shop-wide role selects, not an empty list.
    for (const session of forCaptain.crewedSessions) {
      expect(session.courseTitle).toBeTruthy();
      expect(forCaptain.crewedTripIds).toContain(session.tripId);
    }

    const forInstructor = await getTodayWork(
      db,
      shop.id,
      shop.slug,
      shop.timezone,
      undefined,
      instructor.id,
    );
    expect(forInstructor.crewedSessions.length).toBeGreaterThan(0);
    for (const session of forInstructor.crewedSessions) {
      expect(session.courseTitle).toBeTruthy();
      expect(session.ready + session.blocked).toBeLessThanOrEqual(session.booked);
    }

    const anonymous = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(anonymous.crewedTripIds).toHaveLength(0);
    expect(anonymous.crewedSessions).toHaveLength(0);
  });

  describe("ops alerts (task 157)", () => {
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
      expect(
        otherWork.actions.find((a) => a.id === `stuck-payment-op:${intent.id}`),
      ).toBeUndefined();
    });
  });
});

/**
 * DOM-H3 — the head count that says whether anybody is still in the water.
 *
 * These cases are deliberately adversarial, because the alarm has to survive an
 * empty checkpoint, a half-recorded one, an undo, a second dive, another
 * tenant, a boat that already went home — and, the two that used to break it:
 *
 * - a crew member tapping the only control that isn't "Boarded" **after a
 *   dive**, which means "not back yet, check again" and used to *close* the
 *   count instead of opening it;
 * - the divers who never showed up, who used to be counted as unaccounted-for
 *   in the water on every trip, until the red row meant nothing.
 */
describe("unclosed roll call (DOM-H3)", () => {
  const HOUR = 60 * 60 * 1000;

  /**
   * A departure that already tied up, with `divers` bookings on it. Inserted
   * directly rather than through `createBooking`: the booking path (rightly)
   * refuses to sell a seat on a boat that has already sailed, and this fixture
   * is about what the log looks like afterwards.
   *
   * `endedHoursAgo` may be negative, which puts the boat still out on the water.
   */
  async function returnedTrip(
    db: ReturnType<typeof fileScopedShopContext>["db"],
    shopId: string,
    options: { endedHoursAgo: number; divers: number; plannedDives?: number; title?: string },
  ) {
    // The unit-test clock is frozen (vitest.config.ts's DIVEDAY_CLOCK) and the
    // demo seed is anchored to it, so every fixture instant is measured from
    // `nowMs()` — a real `nowMs()` here would land days away from the seed.
    const endsAt = new Date(nowMs() - options.endedHoursAgo * HOUR);
    const [trip] = await db
      .insert(tripsTable)
      .values({
        shopId,
        title: options.title ?? "Returned Two-Tank — Molasses",
        startsAt: new Date(endsAt.getTime() - 4 * HOUR),
        endsAt,
        capacity: 12,
        plannedDives: options.plannedDives ?? 1,
        priceCents: 13000,
      })
      .returning();
    if (!trip) throw new Error("fixture trip insert returned no row");
    const divers = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.shopId, shopId))
      .limit(options.divers);
    if (divers.length < options.divers) throw new Error("seed has too few people for this fixture");
    const rows = await db
      .insert(bookingsTable)
      .values(
        divers.map((diver) => ({
          bookedAs: "diver" as const,
          shopId,
          tripId: trip.id,
          personId: diver.id,
          status: "checked_in" as const,
        })),
      )
      .returning();
    const [staff] = await listStaff(db, shopId);
    if (!staff) throw new Error("seed staff missing");
    return { trip, bookingIds: rows.map((row) => row.id), staffId: staff.person.id };
  }

  /**
   * Board every diver at the dock, by direct insert.
   *
   * Not `recordRollCall`: that (rightly) refuses to board anyone whose
   * readiness isn't clear, and this fixture's trip has no requirements row, so
   * every diver on it reads blocked. What is being set up here is the *log* a
   * boat leaves behind, and the log this suite cares about is "these people
   * were on the boat" — the precondition for an after-dive count existing at
   * all.
   */
  async function boardAtDeparture(
    db: ReturnType<typeof fileScopedShopContext>["db"],
    input: { shopId: string; tripId: string; staffId: string; bookingIds: readonly string[] },
    occurredAt = new Date(nowMs() - 5 * HOUR),
  ) {
    await db.insert(rollCallEventsTable).values(
      input.bookingIds.map((bookingId) => ({
        shopId: input.shopId,
        tripId: input.tripId,
        bookingId,
        recordedByPersonId: input.staffId,
        status: "boarded" as const,
        checkpoint: "departure",
        source: "live" as const,
        occurredAt,
      })),
    );
  }

  const rollCallRows = (work: Awaited<ReturnType<typeof getTodayWork>>, tripId: string) =>
    work.actions.filter((action) => action.id.startsWith(`roll-call:${tripId}:`));
  const rollCallRow = (
    work: Awaited<ReturnType<typeof getTodayWork>>,
    tripId: string,
    reason: string,
  ) => work.actions.find((action) => action.id.startsWith(`roll-call:${tripId}:${reason}:`));
  const afterDiveRow = (work: Awaited<ReturnType<typeof getTodayWork>>, tripId: string) =>
    rollCallRow(work, tripId, "missing_diver") ?? rollCallRow(work, tripId, "after_dive_uncounted");

  describe("a diver who did not come back", () => {
    /**
     * The defect this whole suite is built around. On the swim step after dive
     * one the DM counts twelve back and one not, and taps the only control that
     * isn't "Boarded". `not_boarded` at an *after-dive* checkpoint means "did
     * not return to the boat" — the missing-diver event itself — and used to
     * read as "accounted for", closing the checkpoint, closing every later one
     * by carry-forward, clearing the board badge, and letting the trip age out
     * of the window with no residue at all.
     */
    it("raises the loudest row in the app when a diver is marked not back aboard", async () => {
      const { db, shop } = ctx;
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: 2,
        divers: 3,
      });
      await boardAtDeparture(db, { shopId: shop.id, tripId: trip.id, staffId, bookingIds });
      for (const [index, bookingId] of bookingIds.entries()) {
        const outcome = await recordRollCall(db, {
          shopId: shop.id,
          tripId: trip.id,
          bookingId,
          recordedByPersonId: staffId,
          status: index === 0 ? "not_boarded" : "boarded",
          checkpoint: "after_dive_1",
        });
        expect(outcome.ok).toBe(true);
      }

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      const row = rollCallRow(work, trip.id, "missing_diver");

      expect(row).toBeDefined();
      expect(row?.kind).toBe("roll_call_missing_diver");
      expect(row?.urgency).toBe("imminent");
      expect(row?.detail).toContain("not back aboard");
      expect(row?.href).toBe(
        `/shop/${shop.slug}/trips/${trip.id}/manifest?checkpoint=after_dive_1`,
      );
      // Every other diver has a result, so this is the only row on the boat —
      // and it must never be worded as an unfinished count.
      expect(rollCallRows(work, trip.id)).toHaveLength(1);
      // It outranks everything else on the queue, whatever else is due today.
      const [first] = sortStationRows(work.actions);
      expect(first?.id).toBe(row?.id);
    });

    it("does not let a later closed checkpoint bury it", async () => {
      const { db, shop } = ctx;
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: 2,
        divers: 2,
        plannedDives: 2,
      });
      await boardAtDeparture(db, { shopId: shop.id, tripId: trip.id, staffId, bookingIds });
      const [missing, aboard] = bookingIds;
      if (!missing || !aboard) throw new Error("fixture bookings missing");
      // Dive one: one diver never came back. Dive two: the crew counted the one
      // diver they still had, so that checkpoint looks tidy. The missing diver
      // must still be the row — carry-forward must never turn an after-dive
      // `not_boarded` into "accounted for" at a later checkpoint.
      await recordRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: missing,
        recordedByPersonId: staffId,
        status: "not_boarded",
        checkpoint: "after_dive_1",
      });
      for (const checkpoint of ["after_dive_1", "after_dive_2"] as const) {
        await recordRollCall(db, {
          shopId: shop.id,
          tripId: trip.id,
          bookingId: aboard,
          recordedByPersonId: staffId,
          status: "boarded",
          checkpoint,
        });
      }

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      const row = rollCallRow(work, trip.id, "missing_diver");
      expect(row?.detail).toContain("dive 1");
      expect(rollCallRow(work, trip.id, "after_dive_uncounted")).toBeUndefined();
    });

    it("keeps saying so at a lower urgency once the trip is too old to settle on the dock", async () => {
      const { db, shop } = ctx;
      // Five days back: past the 48h dock-work window. This used to age to
      // nothing at all — the row left Today and the board with nothing anywhere
      // saying a count had never closed. A missing-diver signal that
      // self-clears is not a signal.
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: 24 * 5,
        divers: 2,
      });
      await boardAtDeparture(
        db,
        { shopId: shop.id, tripId: trip.id, staffId, bookingIds },
        new Date(nowMs() - 24 * 5 * HOUR - 3 * HOUR),
      );
      const [missing] = bookingIds;
      if (!missing) throw new Error("fixture booking missing");
      await recordRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: missing,
        recordedByPersonId: staffId,
        status: "not_boarded",
        checkpoint: "after_dive_1",
        occurredAt: new Date(nowMs() - 24 * 5 * HOUR),
      });

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      const row = rollCallRow(work, trip.id, "missing_diver");
      expect(row).toBeDefined();
      expect(row?.urgency).toBe("soon");
      // The residue clause, which only the stale copy carries — the fresh
      // missing-diver row ends at "after dive 1." Pinned on
      // this phrase rather than the whole sentence: the wording has been
      // trimmed once and may be again, and what must survive is that an aged
      // row still says the count never closed and names the manifest as where
      // to reconstruct it.
      expect(row?.detail).toContain("still marked not back aboard");
      expect(row?.detail).toContain("from the manifest");
      // Still the same kind: what happened did not become less serious, only
      // less settleable on the dock.
      expect(row?.kind).toBe("roll_call_missing_diver");
    });

    /**
     * The two surfaces must not disagree about who is still in the water, and
     * until 2026-08-15 nothing made that a property of the data. Both readers
     * order by `occurred_at` then `created_at` and keep the last row; both of
     * those tie exactly when two events are written inside one transaction
     * (`created_at` is `defaultNow()` — *transaction* time), so the winner was
     * whatever order the heap handed back, and it was free to differ between
     * two queries in one request.
     *
     * That is not hypothetical here: an offline batch syncs a device's queued
     * events together, carrying the device's own timestamps.
     *
     * This constructs the tie rather than trusting the clock's resolution to
     * avoid it — a correction from `boarded` to `not_boarded` appended second,
     * on one booking at one checkpoint. `seq` is the only key that separates
     * them, so if either reader loses it, one of these two assertions fails.
     */
    it("agrees with the manifest when two events tie on both timestamps", async () => {
      const { db, shop } = ctx;
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: -1,
        divers: 1,
        plannedDives: 1,
      });
      const bookingId = bookingIds[0];
      if (!bookingId) throw new Error("fixture produced no booking");
      await boardAtDeparture(db, { shopId: shop.id, tripId: trip.id, staffId, bookingIds });

      const occurredAt = new Date(nowMs() - 30 * 60 * 1000);
      await db.transaction(async (tx) => {
        await tx.insert(rollCallEventsTable).values([
          {
            shopId: shop.id,
            tripId: trip.id,
            bookingId,
            recordedByPersonId: staffId,
            status: "boarded" as const,
            checkpoint: "after_dive_1",
            source: "live" as const,
            occurredAt,
          },
          {
            shopId: shop.id,
            tripId: trip.id,
            bookingId,
            recordedByPersonId: staffId,
            status: "not_boarded" as const,
            checkpoint: "after_dive_1",
            source: "live" as const,
            occurredAt,
          },
        ]);
      });

      // The tie is real, not assumed: assert both old keys are equal before
      // asserting anything about who wins. Without this the test could pass
      // because the clock happened to separate them.
      const written = await db
        .select({ createdAt: rollCallEventsTable.createdAt, seq: rollCallEventsTable.seq })
        .from(rollCallEventsTable)
        .where(
          and(
            eq(rollCallEventsTable.bookingId, bookingId),
            eq(rollCallEventsTable.checkpoint, "after_dive_1"),
          ),
        );
      expect(written).toHaveLength(2);
      const [first, second] = written;
      if (!first || !second) throw new Error("expected both events");
      expect(first.createdAt.getTime()).toBe(second.createdAt.getTime());
      expect(new Set(written.map((row) => row.seq)).size).toBe(2);

      const manifest = await getTripManifest(db, shop.id, trip.id, "after_dive_1");
      expect(manifest?.divers.find((entry) => entry.bookingId === bookingId)?.rollCall?.state).toBe(
        "not_boarded",
      );

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      expect(rollCallRow(work, trip.id, "missing_diver")).toBeDefined();
    });
  });

  /**
   * Review 20260803, D1. The per-person crew half reached this function not at
   * all: a crew member tapped "not back aboard" against a divemaster, the
   * manifest went red with `crew_not_back_aboard` — its own comment calls it
   * "the loudest thing on this list" — and Today showed nothing, the schedule
   * board badged nothing, and neither the 48-hour dock-work chase nor the
   * 30-day residue a *diver* gets applied. On dive two the DM goes back down
   * for a lost weight belt and does not surface: this is that boat.
   */
  describe("a crew member who did not come back", () => {
    /** Roster `count` staff onto the trip and board them all at the dock. */
    async function crewAboard(
      db: ReturnType<typeof fileScopedShopContext>["db"],
      input: { shopId: string; tripId: string; count: number },
      occurredAt = new Date(nowMs() - 5 * HOUR),
    ) {
      const staff = (await listStaff(db, input.shopId)).slice(0, input.count);
      if (staff.length < input.count) throw new Error("seed has too few staff for this fixture");
      const personIds = staff.map((entry) => entry.person.id);
      await db
        .insert(tripAssignments)
        .values(personIds.map((personId) => ({ tripId: input.tripId, personId })));
      await db.insert(rollCallCrewEventsTable).values(
        personIds.map((personId) => ({
          shopId: input.shopId,
          tripId: input.tripId,
          personId,
          recordedByPersonId: personIds[0] ?? personId,
          status: "boarded" as const,
          checkpoint: "departure",
          occurredAt,
        })),
      );
      return personIds;
    }

    it("raises a crew row of its own when a named crew member is marked not back aboard", async () => {
      const { db, shop } = ctx;
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: 2,
        divers: 2,
        plannedDives: 2,
      });
      await boardAtDeparture(db, { shopId: shop.id, tripId: trip.id, staffId, bookingIds });
      // Every diver came back from both dives — the diver half is closed, and
      // before this that was the whole of what Today looked at.
      for (const bookingId of bookingIds) {
        for (const checkpoint of ["after_dive_1", "after_dive_2"] as const) {
          await recordRollCall(db, {
            shopId: shop.id,
            tripId: trip.id,
            bookingId,
            recordedByPersonId: staffId,
            status: "boarded",
            checkpoint,
          });
        }
      }
      const [dm, second] = await crewAboard(db, {
        shopId: shop.id,
        tripId: trip.id,
        count: 2,
      });
      if (!dm || !second) throw new Error("fixture crew missing");
      for (const personId of [dm, second]) {
        await recordCrewRollCall(db, {
          shopId: shop.id,
          tripId: trip.id,
          personId,
          recordedByPersonId: second,
          status: "boarded",
          checkpoint: "after_dive_1",
        });
      }
      // Dive two: the DM went back down for a lost weight belt.
      await recordCrewRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        personId: dm,
        recordedByPersonId: second,
        status: "not_boarded",
        checkpoint: "after_dive_2",
      });
      await recordCrewRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        personId: second,
        recordedByPersonId: second,
        status: "boarded",
        checkpoint: "after_dive_2",
      });

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      const row = rollCallRow(work, trip.id, "missing_crew");
      expect(row).toBeDefined();
      expect(row?.kind).toBe("roll_call_missing_crew");
      // Same tone band and same urgency a diver gets — a crew member is not
      // less findable than a customer.
      expect(row?.urgency).toBe("imminent");
      expect(row?.detail).toContain("crew");
      expect(row?.detail).toContain("not back aboard");
      expect(row?.href).toBe(
        `/shop/${shop.slug}/trips/${trip.id}/manifest?checkpoint=after_dive_2`,
      );
      // No diver row: the two halves are separate rows and the crew one is not
      // worded as a diver problem.
      expect(rollCallRow(work, trip.id, "missing_diver")).toBeUndefined();
      // And it leads the queue, exactly as the diver row does.
      const [first] = sortStationRows(work.actions);
      expect(first?.id).toBe(row?.id);
    });

    it("keeps saying so as residue, on the same schedule a diver's row ages by", async () => {
      const { db, shop } = ctx;
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: 24 * 5,
        divers: 2,
      });
      await boardAtDeparture(
        db,
        { shopId: shop.id, tripId: trip.id, staffId, bookingIds },
        new Date(nowMs() - 24 * 5 * HOUR - 3 * HOUR),
      );
      const [dm] = await crewAboard(
        db,
        { shopId: shop.id, tripId: trip.id, count: 1 },
        new Date(nowMs() - 24 * 5 * HOUR - 3 * HOUR),
      );
      if (!dm) throw new Error("fixture crew missing");
      await recordCrewRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        personId: dm,
        recordedByPersonId: dm,
        status: "not_boarded",
        checkpoint: "after_dive_1",
        occurredAt: new Date(nowMs() - 24 * 5 * HOUR),
      });

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      const row = rollCallRow(work, trip.id, "missing_crew");
      expect(row).toBeDefined();
      expect(row?.urgency).toBe("soon");
      // Same residue clause as the diver half above, and same reason for
      // matching on it rather than the sentence.
      expect(row?.detail).toContain("from the manifest");
      expect(row?.kind).toBe("roll_call_missing_crew");
    });

    it("raises an unfinished crew count, and stays silent for a shop that never taps one", async () => {
      const { db, shop } = ctx;
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: 2,
        divers: 2,
      });
      await boardAtDeparture(db, { shopId: shop.id, tripId: trip.id, staffId, bookingIds });
      for (const bookingId of bookingIds) {
        await recordRollCall(db, {
          shopId: shop.id,
          tripId: trip.id,
          bookingId,
          recordedByPersonId: staffId,
          status: "boarded",
          checkpoint: "after_dive_1",
        });
      }
      // Two crew boarded at the dock; nobody counted either of them after the
      // dive. That is the crew twin of `after_dive_uncounted`.
      await crewAboard(db, { shopId: shop.id, tripId: trip.id, count: 2 });

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      const row = rollCallRow(work, trip.id, "crew_uncounted");
      expect(row?.kind).toBe("roll_call_crew_unfinished");
      expect(row?.urgency).toBe("imminent");
      expect(row?.detail).toContain("2 of 2 crew");

      // The population rule is what keeps this usable: a shop that has never
      // tapped a crew roll call has no crew subjects, so it raises nothing at
      // all rather than a danger-toned row on every trip it has ever run.
      const quiet = await returnedTrip(db, shop.id, {
        endedHoursAgo: 3,
        divers: 2,
        title: "Returned Two-Tank — no crew roll call",
      });
      await boardAtDeparture(db, {
        shopId: shop.id,
        tripId: quiet.trip.id,
        staffId,
        bookingIds: quiet.bookingIds,
      });
      for (const bookingId of quiet.bookingIds) {
        await recordRollCall(db, {
          shopId: shop.id,
          tripId: quiet.trip.id,
          bookingId,
          recordedByPersonId: staffId,
          status: "boarded",
          checkpoint: "after_dive_1",
        });
      }
      await db.insert(tripAssignments).values({ tripId: quiet.trip.id, personId: staffId });
      const quietWork = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      expect(rollCallRows(quietWork, quiet.trip.id)).toHaveLength(0);
    });
  });

  describe("an after-dive count nobody finished", () => {
    it("alarms when a diver who boarded has no result at the checkpoint", async () => {
      const { db, shop } = ctx;
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: 2,
        divers: 3,
      });
      await boardAtDeparture(db, { shopId: shop.id, tripId: trip.id, staffId, bookingIds });
      for (const bookingId of bookingIds.slice(0, 2)) {
        const outcome = await recordRollCall(db, {
          shopId: shop.id,
          tripId: trip.id,
          bookingId,
          recordedByPersonId: staffId,
          status: "boarded",
          checkpoint: "after_dive_1",
        });
        expect(outcome.ok).toBe(true);
      }

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      const row = rollCallRow(work, trip.id, "after_dive_uncounted");
      expect(row?.kind).toBe("roll_call_unfinished");
      expect(row?.urgency).toBe("imminent");
      expect(row?.dueAt?.getTime()).toBe(trip.endsAt.getTime());
      expect(row?.detail).toContain("1 of 3 divers");
      expect(row?.href).toBe(
        `/shop/${shop.slug}/trips/${trip.id}/manifest?checkpoint=after_dive_1`,
      );
      // The boat is gone from every forward-looking surface — which is precisely
      // why this row had to come from its own backwards query.
      expect(work.departures.some((departure) => departure.tripId === trip.id)).toBe(false);
    });

    it("goes quiet once every diver who boarded is back aboard", async () => {
      const { db, shop } = ctx;
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: 2,
        divers: 3,
      });
      await boardAtDeparture(db, { shopId: shop.id, tripId: trip.id, staffId, bookingIds });
      // "Accounted for" after a dive means one thing and one thing only: back on
      // the boat. There is no other way to close this count.
      for (const bookingId of bookingIds) {
        await recordRollCall(db, {
          shopId: shop.id,
          tripId: trip.id,
          bookingId,
          recordedByPersonId: staffId,
          status: "boarded",
          checkpoint: "after_dive_1",
        });
      }

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      expect(rollCallRows(work, trip.id)).toEqual([]);
    });

    it("re-alarms when a diver is cleared back to awaiting", async () => {
      const { db, shop } = ctx;
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: 2,
        divers: 2,
      });
      await boardAtDeparture(db, { shopId: shop.id, tripId: trip.id, staffId, bookingIds });
      for (const bookingId of bookingIds) {
        await recordRollCall(db, {
          shopId: shop.id,
          tripId: trip.id,
          bookingId,
          recordedByPersonId: staffId,
          status: "boarded",
          checkpoint: "after_dive_1",
        });
      }
      expect(
        rollCallRows(await getTodayWork(db, shop.id, shop.slug, shop.timezone), trip.id),
      ).toEqual([]);

      // A `cleared` event is an undo — the diver reads as awaiting again on the
      // manifest, so the count is open again here too. Roll-call history is
      // append-only, so the older `boarded` row is still in the table.
      const [undone] = bookingIds;
      if (!undone) throw new Error("fixture booking missing");
      await recordRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: undone,
        recordedByPersonId: staffId,
        status: "cleared",
        checkpoint: "after_dive_1",
        occurredAt: new Date(nowMs() + 1000),
      });

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      expect(rollCallRow(work, trip.id, "after_dive_uncounted")?.detail).toContain("1 of 2 divers");
    });

    it("alarms on the second dive of a two-dive trip whose first dive is complete", async () => {
      const { db, shop } = ctx;
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: 3,
        divers: 2,
        plannedDives: 2,
      });
      await boardAtDeparture(db, { shopId: shop.id, tripId: trip.id, staffId, bookingIds });
      for (const bookingId of bookingIds) {
        await recordRollCall(db, {
          shopId: shop.id,
          tripId: trip.id,
          bookingId,
          recordedByPersonId: staffId,
          status: "boarded",
          checkpoint: "after_dive_1",
        });
      }

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      const row = rollCallRow(work, trip.id, "after_dive_uncounted");
      // Reported at the earliest dive still open, and pointed straight at it.
      expect(row?.href).toBe(
        `/shop/${shop.slug}/trips/${trip.id}/manifest?checkpoint=after_dive_2`,
      );
      expect(row?.detail).toContain("dive 2");
    });

    it("does not count a diver who never left the dock", async () => {
      const { db, shop } = ctx;
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: 2,
        divers: 2,
        plannedDives: 2,
      });
      const [ashore, aboard] = bookingIds;
      if (!ashore || !aboard) throw new Error("fixture bookings missing");
      // `not_boarded` at *departure* is the benign half of the word: this diver
      // never got on the boat, so no after-dive count is waiting on them.
      await boardAtDeparture(db, {
        shopId: shop.id,
        tripId: trip.id,
        staffId,
        bookingIds: [aboard],
      });
      await recordRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: ashore,
        recordedByPersonId: staffId,
        status: "not_boarded",
        checkpoint: "departure",
      });
      for (const checkpoint of ["after_dive_1", "after_dive_2"] as const) {
        await recordRollCall(db, {
          shopId: shop.id,
          tripId: trip.id,
          bookingId: aboard,
          recordedByPersonId: staffId,
          status: "boarded",
          checkpoint,
        });
      }

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      expect(rollCallRows(work, trip.id)).toEqual([]);
    });

    it("drops a canceled booking from the count instead of alarming forever", async () => {
      const { db, shop } = ctx;
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: 2,
        divers: 2,
      });
      await boardAtDeparture(db, { shopId: shop.id, tripId: trip.id, staffId, bookingIds });
      const [counted, pulled] = bookingIds;
      if (!counted || !pulled) throw new Error("fixture bookings missing");
      await recordRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: counted,
        recordedByPersonId: staffId,
        status: "boarded",
        checkpoint: "after_dive_1",
      });
      expect(
        afterDiveRow(await getTodayWork(db, shop.id, shop.slug, shop.timezone), trip.id),
      ).toBeDefined();

      // The remaining diver's seat was cancelled — they are off the manifest's
      // roster, so there is nobody left uncounted.
      await cancelBooking(db, shop.id, pulled);

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      expect(rollCallRows(work, trip.id)).toEqual([]);
    });

    it("keeps chasing a boat that came back yesterday", async () => {
      const { db, shop } = ctx;
      // 30 hours back is a different calendar day in every timezone, so this can
      // never be reached by the shop's own "today" filter — the exact case the
      // forward window drops on the floor.
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: 30,
        divers: 4,
      });
      await boardAtDeparture(
        db,
        { shopId: shop.id, tripId: trip.id, staffId, bookingIds },
        new Date(nowMs() - 33 * HOUR),
      );

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      const row = rollCallRow(work, trip.id, "after_dive_uncounted");
      expect(row?.detail).toContain("4 of 4 divers");
      expect(row?.urgency).toBe("imminent");
    });
  });

  describe("a boat that is still out", () => {
    it("says nothing about a checkpoint that has not happened yet", async () => {
      const { db, shop } = ctx;
      // Ends two hours from now, with nothing recorded after departure: the
      // dive-one count is not unfinished, it has not been taken. Alarming here
      // would be guessing at a schedule the app does not hold.
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: -2,
        divers: 3,
      });
      await boardAtDeparture(db, { shopId: shop.id, tripId: trip.id, staffId, bookingIds });

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      expect(rollCallRows(work, trip.id)).toEqual([]);
    });

    it("alarms immediately on a count that was started and abandoned", async () => {
      const { db, shop } = ctx;
      // The case that used to cost three hours of silence: on a four-hour
      // two-tank, dive one's count runs about ninety minutes in. The DM counts
      // two of three and gets pulled away. The boat is still on the mooring and
      // the third diver is still findable — but nothing said anything until
      // `endsAt`.
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: -2,
        divers: 3,
      });
      await boardAtDeparture(db, { shopId: shop.id, tripId: trip.id, staffId, bookingIds });
      for (const bookingId of bookingIds.slice(0, 2)) {
        await recordRollCall(db, {
          shopId: shop.id,
          tripId: trip.id,
          bookingId,
          recordedByPersonId: staffId,
          status: "boarded",
          checkpoint: "after_dive_1",
        });
      }

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      const row = rollCallRow(work, trip.id, "after_dive_uncounted");
      expect(row?.urgency).toBe("imminent");
      expect(row?.detail).toContain("Boat is out");
      expect(row?.detail).toContain("1 of 3 divers");
    });

    it("raises a missing diver while the boat is still on the site", async () => {
      const { db, shop } = ctx;
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: -2,
        divers: 2,
      });
      await boardAtDeparture(db, { shopId: shop.id, tripId: trip.id, staffId, bookingIds });
      const [missing, aboard] = bookingIds;
      if (!missing || !aboard) throw new Error("fixture bookings missing");
      await recordRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: missing,
        recordedByPersonId: staffId,
        status: "not_boarded",
        checkpoint: "after_dive_1",
      });
      await recordRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: aboard,
        recordedByPersonId: staffId,
        status: "boarded",
        checkpoint: "after_dive_1",
      });

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      expect(rollCallRow(work, trip.id, "missing_diver")?.urgency).toBe("imminent");
    });

    /**
     * **A blocked diver aboard stays on the list until the boat is home**
     * (issue #2064). The readiness rows behind the "Aboard" row come from the
     * forward-looking horizon, which drops a departure an hour after it sails,
     * so a diver who boarded on a medical hold vanished while the boat was
     * still out and they may have been in the water. Ashore blockers for a boat
     * that has gone stay gone: nothing is left to stop.
     */
    describe("a blocked diver who boarded", () => {
      async function sailedNinetyMinutesAgo() {
        const { db, shop } = ctx;
        // Four hours long, so it sailed ninety minutes ago and is out for two
        // and a half more: well past the horizon's one-hour buffer.
        const fixture = await returnedTrip(db, shop.id, {
          endedHoursAgo: -2.5,
          divers: 2,
          title: "Blocked Aboard — Molasses",
        });
        const [boarded, ashore] = fixture.bookingIds;
        if (!boarded || !ashore) throw new Error("fixture bookings missing");
        await boardAtDeparture(
          db,
          {
            shopId: shop.id,
            tripId: fixture.trip.id,
            staffId: fixture.staffId,
            bookingIds: [boarded],
          },
          new Date(fixture.trip.startsAt.getTime() + 5 * 60 * 1000),
        );
        return { ...fixture, boarded, ashore };
      }

      const rowsFor = (work: Awaited<ReturnType<typeof getTodayWork>>, tripId: string) =>
        work.actions.filter(
          (action) => action.departure?.tripId === tripId && !action.id.startsWith("roll-call:"),
        );

      it("keeps the Aboard row while the boat is still out, and only that row", async () => {
        const { db, shop } = ctx;
        const { trip, boarded } = await sailedNinetyMinutesAgo();
        // The fixture trip has no requirements row, so both seats read blocked:
        // the premise, checked rather than assumed.
        const readiness = await listTripReadiness(db, shop.id, trip.id);
        expect(readiness.every((row) => row.readiness.status === "blocked")).toBe(true);

        const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
        const rows = rowsFor(work, trip.id);
        expect(rows.map((row) => row.kind)).toEqual(["blocked_aboard"]);
        expect(rows[0]?.id).toContain(boarded);
        // The home files it into Needs you rather than under the week's count.
        expect(work.outTripIds).toContain(trip.id);
        // The departure is not a live station again: the closing state owns it.
        expect(work.departures.some((departure) => departure.tripId === trip.id)).toBe(false);
      });

      it("counts the diver aboard in the nav badge until the boat is home", async () => {
        const { db, shop } = ctx;
        const { trip, staffId } = await sailedNinetyMinutesAgo();
        const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
        const badge = await countBlockedDiversNextBoatDay(db, shop.id, shop.timezone);
        // The one boarded diver, not the one left ashore on a boat that has gone.
        expect(work.blockedAboard).toBeGreaterThanOrEqual(1);
        expect(badge.aboard).toBe(work.blockedAboard);
        expect(badge.total).toBe(badge.onDay + badge.aboard);

        await recordTripStage(db, {
          shopId: shop.id,
          tripId: trip.id,
          stage: "home",
          recordedByPersonId: staffId,
          recordedAt: nowDate(),
        });
        const home = await countBlockedDiversNextBoatDay(db, shop.id, shop.timezone);
        expect(home.aboard).toBe(badge.aboard - 1);
      });

      it("drops the row once the crew says the boat is home", async () => {
        const { db, shop } = ctx;
        const { trip, staffId } = await sailedNinetyMinutesAgo();
        const recorded = await recordTripStage(db, {
          shopId: shop.id,
          tripId: trip.id,
          stage: "home",
          recordedByPersonId: staffId,
          recordedAt: nowDate(),
        });
        expect(recorded.ok).toBe(true);

        const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
        expect(rowsFor(work, trip.id)).toEqual([]);
        expect(work.outTripIds).not.toContain(trip.id);
      });

      it("drops the row once the boat is back by the clock", async () => {
        const { db, shop } = ctx;
        // Tied up two hours ago, past the return buffer, with nobody tapping.
        const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
          endedHoursAgo: 2,
          divers: 1,
          title: "Blocked Aboard, home — Molasses",
        });
        await boardAtDeparture(db, { shopId: shop.id, tripId: trip.id, staffId, bookingIds });

        const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
        expect(rowsFor(work, trip.id)).toEqual([]);
        expect(work.outTripIds).not.toContain(trip.id);
      });

      it("drops the row once the crew count the diver back aboard after the last dive", async () => {
        // The boat is still out by the clock, but the diver this row is about
        // is out of the water: the evening's "All boats are home" line reads
        // the same count, and the two must not disagree.
        const { db, shop } = ctx;
        const { trip, boarded, staffId } = await sailedNinetyMinutesAgo();
        await recordRollCall(db, {
          shopId: shop.id,
          tripId: trip.id,
          bookingId: boarded,
          recordedByPersonId: staffId,
          status: "boarded",
          checkpoint: "after_dive_1",
        });

        const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
        expect(rowsFor(work, trip.id)).toEqual([]);
        expect(work.outTripIds).toContain(trip.id);
      });

      it("keeps the row while a dive is still to come", async () => {
        // Counted back after dive one of two is a surface interval, not home.
        const { db, shop } = ctx;
        const fixture = await returnedTrip(db, shop.id, {
          endedHoursAgo: -2.5,
          divers: 1,
          plannedDives: 2,
          title: "Blocked Aboard, two tanks — Molasses",
        });
        const [boarded] = fixture.bookingIds;
        if (!boarded) throw new Error("fixture booking missing");
        await boardAtDeparture(
          db,
          {
            shopId: shop.id,
            tripId: fixture.trip.id,
            staffId: fixture.staffId,
            bookingIds: [boarded],
          },
          new Date(fixture.trip.startsAt.getTime() + 5 * 60 * 1000),
        );
        await recordRollCall(db, {
          shopId: shop.id,
          tripId: fixture.trip.id,
          bookingId: boarded,
          recordedByPersonId: fixture.staffId,
          status: "boarded",
          checkpoint: "after_dive_1",
        });

        const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
        expect(rowsFor(work, fixture.trip.id).map((row) => row.kind)).toEqual(["blocked_aboard"]);
      });

      /**
       * **Boarded after the dock count** (issue #2142). A two-site day where a
       * diver is picked up at the second site, or rides out on a chase boat:
       * the crew's first word about them is `boarded` at `after_dive_1`, and
       * their dock result is empty or `not_boarded`. They are aboard, on a
       * medical hold, while the boat is out — the row this describe exists for.
       */
      describe("first counted aboard after the dock count", () => {
        async function insertRollCall(input: {
          tripId: string;
          bookingId: string;
          staffId: string;
          status: "boarded" | "not_boarded" | "cleared";
          checkpoint: string;
          occurredAt?: Date;
        }) {
          await ctx.db.insert(rollCallEventsTable).values({
            shopId: ctx.shop.id,
            tripId: input.tripId,
            bookingId: input.bookingId,
            recordedByPersonId: input.staffId,
            status: input.status,
            checkpoint: input.checkpoint,
            source: "live",
            occurredAt: input.occurredAt ?? nowDate(),
          });
        }

        async function twoSiteDay(dockResult: "none" | "not_boarded", endedHoursAgo = -2.5) {
          const { db, shop } = ctx;
          const fixture = await returnedTrip(db, shop.id, {
            endedHoursAgo,
            divers: 1,
            plannedDives: 2,
            title: "Blocked Aboard, second site — Molasses",
          });
          const [pickedUp] = fixture.bookingIds;
          if (!pickedUp) throw new Error("fixture booking missing");
          const base = { tripId: fixture.trip.id, bookingId: pickedUp, staffId: fixture.staffId };
          if (dockResult === "not_boarded") {
            await insertRollCall({
              ...base,
              status: "not_boarded",
              checkpoint: "departure",
              occurredAt: new Date(fixture.trip.startsAt.getTime() + 5 * 60 * 1000),
            });
          }
          await insertRollCall({ ...base, status: "boarded", checkpoint: "after_dive_1" });
          return { ...fixture, pickedUp };
        }

        it("keeps the Aboard row for a diver with no dock result", async () => {
          const { db, shop } = ctx;
          const { trip, pickedUp } = await twoSiteDay("none");
          const readiness = await listTripReadiness(db, shop.id, trip.id);
          expect(readiness.every((row) => row.readiness.status === "blocked")).toBe(true);

          const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
          const rows = rowsFor(work, trip.id);
          expect(rows.map((row) => row.kind)).toEqual(["blocked_aboard"]);
          expect(rows[0]?.id).toContain(pickedUp);
          expect(work.outTripIds).toContain(trip.id);
          const badge = await countBlockedDiversNextBoatDay(db, shop.id, shop.timezone);
          expect(work.blockedAboard).toBeGreaterThanOrEqual(1);
          expect(badge.aboard).toBe(work.blockedAboard);
        });

        it("keeps the Aboard row for a diver marked not boarded at the dock", async () => {
          const { db, shop } = ctx;
          const { trip, pickedUp } = await twoSiteDay("not_boarded");

          const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
          const rows = rowsFor(work, trip.id);
          expect(rows.map((row) => row.kind)).toEqual(["blocked_aboard"]);
          expect(rows[0]?.id).toContain(pickedUp);
        });

        it("keeps a cancelled departure out when its only boarding came after the dock", async () => {
          const { db, shop } = ctx;
          const { trip } = await twoSiteDay("none");
          await db
            .update(tripsTable)
            .set({ status: "cancelled" })
            .where(eq(tripsTable.id, trip.id));

          const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
          expect(rowsFor(work, trip.id).map((row) => row.kind)).toEqual(["blocked_aboard"]);
          expect(work.outTripIds).toContain(trip.id);
        });

        it("drops the row when the after-dive boarding is undone", async () => {
          const { db, shop } = ctx;
          const { trip, pickedUp, staffId } = await twoSiteDay("none");
          await insertRollCall({
            tripId: trip.id,
            bookingId: pickedUp,
            staffId,
            status: "cleared",
            checkpoint: "after_dive_1",
            occurredAt: new Date(nowMs() + 1000),
          });

          const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
          expect(rowsFor(work, trip.id)).toEqual([]);
        });

        it("drops the row for a booking cancelled after it boarded", async () => {
          const { db, shop } = ctx;
          const { trip, pickedUp } = await twoSiteDay("none");
          await db
            .update(bookingsTable)
            .set({ status: "cancelled" })
            .where(eq(bookingsTable.id, pickedUp));

          const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
          expect(rowsFor(work, trip.id)).toEqual([]);
        });

        it("never reads an after-dive not boarded as aboard", async () => {
          // That word is the missing-diver row's, which already exists; the
          // Aboard row stays about somebody the crew counted onto the boat.
          const { db, shop } = ctx;
          const fixture = await returnedTrip(db, shop.id, {
            endedHoursAgo: -2.5,
            divers: 1,
            plannedDives: 2,
            title: "Blocked, never aboard — Molasses",
          });
          const [diver] = fixture.bookingIds;
          if (!diver) throw new Error("fixture booking missing");
          await insertRollCall({
            tripId: fixture.trip.id,
            bookingId: diver,
            staffId: fixture.staffId,
            status: "not_boarded",
            checkpoint: "after_dive_1",
          });

          const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
          expect(rowsFor(work, fixture.trip.id).map((row) => row.kind)).not.toContain(
            "blocked_aboard",
          );
        });

        it("marks the in-window row Aboard by the same rule", async () => {
          // Sailed half an hour ago, so still a live station: the ordinary
          // path draws the row, and it must agree with the boats-out path.
          const { db, shop } = ctx;
          const { trip, pickedUp } = await twoSiteDay("none", -3.5);

          const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
          expect(work.departures.some((departure) => departure.tripId === trip.id)).toBe(true);
          const kinds = rowsFor(work, trip.id)
            .filter((row) => row.id.includes(pickedUp))
            .map((row) => row.kind);
          expect(kinds).toEqual(["blocked_aboard"]);
        });
      });

      it("keeps the Aboard row when the desk cancels the departure after it boarded", async () => {
        // The roll call outranks a later desk word, as for the fly-safe reader
        // (#1836): the boarding was recorded before the cancel and the diver is
        // on that boat whatever the status column now says.
        const { db, shop } = ctx;
        const { trip, boarded } = await sailedNinetyMinutesAgo();
        await db.update(tripsTable).set({ status: "cancelled" }).where(eq(tripsTable.id, trip.id));

        const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
        const rows = rowsFor(work, trip.id);
        expect(rows.map((row) => row.kind)).toEqual(["blocked_aboard"]);
        expect(rows[0]?.id).toContain(boarded);
        expect(work.outTripIds).toContain(trip.id);
      });

      it("says nothing about a cancelled departure nobody boarded", async () => {
        const { db, shop } = ctx;
        const { trip } = await returnedTrip(db, shop.id, {
          endedHoursAgo: -2.5,
          divers: 2,
          title: "Blown out — Molasses",
        });
        await db.update(tripsTable).set({ status: "cancelled" }).where(eq(tripsTable.id, trip.id));

        const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
        expect(rowsFor(work, trip.id)).toEqual([]);
        expect(work.outTripIds).not.toContain(trip.id);
      });
    });
  });

  describe("the dock count, which is paperwork", () => {
    /**
     * Alarm fatigue is a safety property. Crews tap "Boarded" for the people in
     * front of them and never touch the two who didn't show — there is no bulk
     * action, and the counter's no-show mark (`markBookingNoShow`,
     * src/db/no-show.ts) writes `bookings.status`, never a `roll_call_events`
     * row, so a walk-away arrives here with no result at any checkpoint whether
     * or not the desk released their seat. Counting those two as
     * unaccounted-for after every dive raised a danger-toned row on most real
     * trips, and within a fortnight the red row is wallpaper.
     */
    it("does not treat a walk-away as somebody left in the water", async () => {
      const { db, shop } = ctx;
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: 2,
        divers: 4,
      });
      const sailed = bookingIds.slice(0, 2);
      // Two divers never showed and were never tapped at all. The two who did
      // sail were boarded and counted back.
      await boardAtDeparture(db, {
        shopId: shop.id,
        tripId: trip.id,
        staffId,
        bookingIds: sailed,
      });
      for (const bookingId of sailed) {
        await recordRollCall(db, {
          shopId: shop.id,
          tripId: trip.id,
          bookingId,
          recordedByPersonId: staffId,
          status: "boarded",
          checkpoint: "after_dive_1",
        });
      }

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      // Nobody was ever unaccounted for in the water, so no after-dive row.
      expect(afterDiveRow(work, trip.id)).toBeUndefined();
      // The unfinished dock count is still stated — quietly, in its own words,
      // and never with the wording of a diver who may still be down.
      const row = rollCallRow(work, trip.id, "departure_uncounted");
      expect(row?.kind).toBe("roll_call_departure_open");
      expect(row?.urgency).toBe("now");
      expect(row?.detail).toContain("2 of 4 divers");
      // Its own words, never the after-dive ones: nobody here was ever
      // unaccounted for after a dive.
      expect(row?.detail).toMatch(/dock count/i);
      expect(row?.detail).not.toContain("not back aboard");
      expect(row?.href).toBe(`/shop/${shop.slug}/trips/${trip.id}/manifest?checkpoint=departure`);
    });

    it("sorts below every after-dive row, so it can never lead the queue", async () => {
      const { db, shop } = ctx;
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: 2,
        divers: 3,
      });
      // One diver was never tapped at the dock; the two who boarded were never
      // counted back. Both rows exist — the after-dive one must lead.
      await boardAtDeparture(db, {
        shopId: shop.id,
        tripId: trip.id,
        staffId,
        bookingIds: bookingIds.slice(0, 2),
      });

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      const rows = rollCallRows(work, trip.id);
      expect(rows.map((row) => row.kind).sort()).toEqual([
        "roll_call_departure_open",
        "roll_call_unfinished",
      ]);
      const [first] = sortStationRows(work.actions);
      expect(first?.kind).toBe("roll_call_unfinished");
    });

    it("calls a trip with no roll call at all what it is, at a lower severity", async () => {
      const { db, shop } = ctx;
      // Not a lost diver: a shop that isn't using the feature. Reading it as
      // fine would be a false all-clear, so it is still said — just not in the
      // words of a person who may be in the water.
      const { trip } = await returnedTrip(db, shop.id, { endedHoursAgo: 2, divers: 3 });

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      const rows = rollCallRows(work, trip.id);
      expect(rows.map((row) => row.kind)).toEqual(["roll_call_not_started"]);
      const [row] = rows;
      expect(row?.urgency).toBe("now");
      expect(row?.detail).toContain("No roll call recorded");
      expect(row?.detail).not.toContain("not back aboard");
      expect(row?.href).toBe(`/shop/${shop.slug}/trips/${trip.id}/manifest?checkpoint=departure`);
    });

    it("stops chasing the dock count once the trip is older than the lookback", async () => {
      const { db, shop } = ctx;
      // Paperwork ages out; the after-dive signal above does not. Carrying a
      // month of missing dock counts would bury the rows that matter.
      const { trip } = await returnedTrip(db, shop.id, { endedHoursAgo: 24 * 5, divers: 3 });

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      expect(rollCallRows(work, trip.id)).toEqual([]);
    });
  });

  describe("bounds", () => {
    /**
     * The cap used to be `limit(20)` over `asc(endsAt)`, applied *before* any
     * openness test: a busy four-boat operation with more than twenty trips in
     * the window kept the twenty oldest — mostly already closed — and silently
     * dropped the boat that had just tied up with an open count.
     */
    it("never drops the boat that just tied up behind older, closed ones", async () => {
      const { db, shop } = ctx;
      // Twenty-four earlier boats, all closed, then the one that matters.
      for (let index = 0; index < 24; index++) {
        const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
          endedHoursAgo: 40 - index,
          divers: 1,
          title: `Closed boat ${index}`,
        });
        await boardAtDeparture(
          db,
          { shopId: shop.id, tripId: trip.id, staffId, bookingIds },
          new Date(nowMs() - (44 - index) * HOUR),
        );
        for (const bookingId of bookingIds) {
          await recordRollCall(db, {
            shopId: shop.id,
            tripId: trip.id,
            bookingId,
            recordedByPersonId: staffId,
            status: "boarded",
            checkpoint: "after_dive_1",
          });
        }
      }
      const {
        trip: newest,
        bookingIds,
        staffId,
      } = await returnedTrip(db, shop.id, {
        endedHoursAgo: 1,
        divers: 3,
        title: "The 16:30 boat",
      });
      await boardAtDeparture(db, { shopId: shop.id, tripId: newest.id, staffId, bookingIds });

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      expect(rollCallRow(work, newest.id, "after_dive_uncounted")?.detail).toContain(
        "3 of 3 divers",
      );
    });

    it("is tenant-safe: another shop's queue never sees this boat", async () => {
      const { db, shop } = ctx;
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: 2,
        divers: 3,
      });
      await boardAtDeparture(db, { shopId: shop.id, tripId: trip.id, staffId, bookingIds });

      const otherWork = await getTodayWork(
        db,
        "00000000-0000-4000-8000-000000000000",
        "other-shop",
        shop.timezone,
      );

      expect(rollCallRows(otherWork, trip.id)).toEqual([]);
      expect(otherWork.actions.every((action) => !action.kind.startsWith("roll_call_"))).toBe(true);
    });

    it("points the row inside this shop and leads the whole queue", async () => {
      const { db, shop } = ctx;
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: 2,
        divers: 3,
      });
      await boardAtDeparture(db, { shopId: shop.id, tripId: trip.id, staffId, bookingIds });

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      const [first] = sortStationRows(work.actions);

      expect(first?.id).toBe(`roll-call:${trip.id}:after_dive_uncounted:after_dive_1`);
      expect(first?.href.startsWith(`/shop/${shop.slug}/`)).toBe(true);
    });
  });

  describe("gear register rows (ADR 20260815-minimal-gear-register)", () => {
    async function anySeededBooking(
      db: ReturnType<typeof fileScopedShopContext>["db"],
      shopId: string,
    ) {
      const [booking] = await db
        .select({ id: bookingsTable.id, personId: bookingsTable.personId })
        .from(bookingsTable)
        .where(and(eq(bookingsTable.shopId, shopId), eq(bookingsTable.status, "booked")))
        .limit(1);
      if (!booking) throw new Error("seeded booking missing");
      return booking;
    }

    it("the seeded fleet alone puts nothing on the queue — its clocks and windows are all ahead", async () => {
      const { db, shop } = ctx;
      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      expect(work.actions.filter((action) => action.kind.startsWith("gear_"))).toEqual([]);
    });

    it("chases a unit that never came home, and lets a return clear the row", async () => {
      const { db, shop } = ctx;
      const today = calendarDateInTimezone(nowDate(), shop.timezone);
      const item = await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #90" });
      if (!item.ok) throw new Error("item refused");
      const booking = await anySeededBooking(db, shop.id);
      const reserved = await reserveGearUnit(db, {
        shopId: shop.id,
        gearItemId: item.item.id,
        bookingId: booking.id,
        reservedFrom: shiftCalendarDate(today, -4),
        reservedUntil: shiftCalendarDate(today, -2),
      });
      if (!reserved.ok) throw new Error("reserve refused");

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      const row = work.actions.find((action) => action.id === `gear-overdue:${booking.personId}`);
      expect(row).toMatchObject({
        kind: "gear_overdue",
        urgency: "now",
        href: `/shop/${shop.slug}/gear`,
      });
      expect(row?.detail).toContain("BCD #90");
      expect(row?.dueAt?.getTime()).toBeLessThanOrEqual(nowMs());

      await returnGearReservation(db, {
        shopId: shop.id,
        reservationId: reserved.reservation.id,
      });
      const cleared = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      expect(
        cleared.actions.some((action) => action.id === `gear-overdue:${booking.personId}`),
      ).toBe(false);
    });

    it("folds one diver's overdue units into one row, a sentence per chase and per day", async () => {
      const { db, shop } = ctx;
      const today = calendarDateInTimezone(nowDate(), shop.timezone);
      const booking = await anySeededBooking(db, shop.id);
      const reserve = async (label: string, until: string) => {
        const item = await createGearItem(db, { shopId: shop.id, kind: "bcd", label });
        if (!item.ok) throw new Error("item refused");
        const reserved = await reserveGearUnit(db, {
          shopId: shop.id,
          gearItemId: item.item.id,
          bookingId: booking.id,
          reservedFrom: shiftCalendarDate(today, -6),
          reservedUntil: until,
        });
        if (!reserved.ok) throw new Error("reserve refused");
      };
      await reserve("BCD #91", shiftCalendarDate(today, -2));
      await reserve("BCD #92", shiftCalendarDate(today, -2));
      await reserve("BCD #93", shiftCalendarDate(today, -1));

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      const rows = work.actions.filter(
        (action) => action.kind === "gear_overdue" && action.detail.includes("BCD #9"),
      );
      expect(rows).toHaveLength(1);
      const [row] = rows;
      expect(row?.id).toBe(`gear-overdue:${booking.personId}`);
      // Never collected, so the "reserved until" sentence; the two units that
      // share a day share it, and the third day keeps a sentence of its own.
      expect(row?.detail).toMatch(
        /^BCD #91 and BCD #92 were reserved until .+ and never picked up\. BCD #93 was reserved until .+ and never picked up\.$/,
      );
    });

    it("lists a unit due back today, dated to the end of the shop's own day", async () => {
      const { db, shop } = ctx;
      const today = calendarDateInTimezone(nowDate(), shop.timezone);
      const item = await createGearItem(db, { shopId: shop.id, kind: "wetsuit", label: "5mm #90" });
      if (!item.ok) throw new Error("item refused");
      const booking = await anySeededBooking(db, shop.id);
      const reserved = await reserveGearUnit(db, {
        shopId: shop.id,
        gearItemId: item.item.id,
        bookingId: booking.id,
        reservedFrom: today,
        reservedUntil: today,
      });
      if (!reserved.ok) throw new Error("reserve refused");

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      const row = work.actions.find((action) => action.id === `gear-due-back:${booking.personId}`);
      expect(row).toMatchObject({ kind: "gear_due_back" });
      // Due by tonight, not overdue at breakfast: the deadline is the end of
      // the shop-local day and still ahead of now.
      expect(row?.dueAt?.getTime()).toBeGreaterThan(nowMs());
      expect(row?.dueAt?.getTime()).toBeLessThanOrEqual(nowMs() + 24 * 60 * 60 * 1000);
    });

    it("surfaces this week's bench clocks — an expired one as today's work, a distant one not at all", async () => {
      const { db, shop } = ctx;
      const today = calendarDateInTimezone(nowDate(), shop.timezone);
      const lapsed = await createGearItem(db, { shopId: shop.id, kind: "tank", label: "AL80-90" });
      const nextWeek = await createGearItem(db, {
        shopId: shop.id,
        kind: "tank",
        label: "AL80-91",
      });
      const distant = await createGearItem(db, { shopId: shop.id, kind: "tank", label: "AL80-92" });
      if (!lapsed.ok || !nextWeek.ok || !distant.ok) throw new Error("item refused");
      await recordGearService(db, {
        shopId: shop.id,
        gearItemId: lapsed.item.id,
        kind: "visual_inspection",
        servicedOn: shiftCalendarDate(today, -400),
        nextDueOn: shiftCalendarDate(today, -35),
      });
      await recordGearService(db, {
        shopId: shop.id,
        gearItemId: nextWeek.item.id,
        kind: "visual_inspection",
        servicedOn: shiftCalendarDate(today, -362),
        nextDueOn: shiftCalendarDate(today, 3),
      });
      await recordGearService(db, {
        shopId: shop.id,
        gearItemId: distant.item.id,
        kind: "visual_inspection",
        servicedOn: shiftCalendarDate(today, -60),
        nextDueOn: shiftCalendarDate(today, 305),
      });

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      const lapsedRow = work.actions.find(
        (action) => action.id === `gear-service:${lapsed.item.id}`,
      );
      expect(lapsedRow).toMatchObject({
        kind: "gear_service_due",
        urgency: "now",
        subject: "AL80-90",
        href: `/shop/${shop.slug}/gear/${lapsed.item.id}`,
      });
      expect(work.actions.some((action) => action.id === `gear-service:${nextWeek.item.id}`)).toBe(
        true,
      );
      expect(work.actions.some((action) => action.id === `gear-service:${distant.item.id}`)).toBe(
        false,
      );
    });

    it("puts expired kit ashore and lapsed boat papers on one owner row each, never twice", async () => {
      const { db, shop } = ctx;
      const today = calendarDateInTimezone(nowDate(), shop.timezone);
      const hull = await createBoat(db, shop.id, "Papers Hull", 12, null, {
        certifiedPassengers: 12,
        inspectionDueOn: null,
        registrationExpiresOn: null,
        insuranceExpiresOn: shiftCalendarDate(today, -2),
      });
      // Aboard a hull with no departure today: the owner's errand, not a boat row.
      const aed = await createGearItem(db, {
        shopId: shop.id,
        kind: "aed",
        label: "AED Papers Hull",
        aboardBoatId: hull.id,
      });
      if (!aed.ok) throw new Error("item refused");
      await recordGearService(db, {
        shopId: shop.id,
        gearItemId: aed.item.id,
        kind: "aed_pads",
        servicedOn: shiftCalendarDate(today, -700),
        nextDueOn: shiftCalendarDate(today, -3),
      });

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      expect(work.actions.find((a) => a.id === `boat-safety:kit:${aed.item.id}`)).toMatchObject({
        kind: "boat_safety_expired",
        urgency: "now",
        subject: "AED Papers Hull",
        detail: "AED Papers Hull: pads expired 3 days ago",
        href: `/shop/${shop.slug}/gear/${aed.item.id}`,
      });
      expect(work.actions.find((a) => a.id === `boat-safety:boat:${hull.id}`)).toMatchObject({
        kind: "boat_safety_expired",
        subject: "Papers Hull",
        detail: "Insurance expired 2 days ago",
        href: `/shop/${shop.slug}/settings/boats`,
      });
      // Safety kit never rides the register's bench-clock row: one dead AED,
      // one row.
      expect(work.actions.some((a) => a.id === `gear-service:${aed.item.id}`)).toBe(false);
    });

    it("raises a paper inside its window as a quiet owner errand before it lapses", async () => {
      const { db, shop } = ctx;
      const today = calendarDateInTimezone(nowDate(), shop.timezone);
      const hull = await createBoat(db, shop.id, "Inspection Hull", 12, null, {
        certifiedPassengers: null,
        // 75 days out: inside the inspection's 90-day window.
        inspectionDueOn: shiftCalendarDate(today, 75),
        registrationExpiresOn: null,
        insuranceExpiresOn: null,
      });
      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      expect(work.actions.find((a) => a.id === `boat-safety:boat:${hull.id}`)).toMatchObject({
        kind: "boat_papers_due",
        urgency: "later",
        detail: "Next safety inspection due in 75 days",
        href: `/shop/${shop.slug}/settings/boats`,
      });
    });

    it("raises today's departure's missing AED and lapsed flares as one row on that departure", async () => {
      const { db, shop } = ctx;
      const today = calendarDateInTimezone(nowDate(), shop.timezone);
      const [reef] = await db
        .select({ id: tripsTable.id, boatId: tripsTable.boatId, startsAt: tripsTable.startsAt })
        .from(tripsTable)
        .where(
          and(
            eq(tripsTable.shopId, shop.id),
            eq(tripsTable.title, "Two-Tank Reef — Molasses & French"),
            isNull(tripsTable.deletedAt),
          ),
        )
        .orderBy(tripsTable.startsAt)
        .limit(1);
      if (!reef?.boatId) throw new Error("the seeded reef trip sails on no boat");
      const [hull] = await db
        .select({ name: boatsTable.name })
        .from(boatsTable)
        .where(eq(boatsTable.id, reef.boatId));
      // The shop keeps an AED — on the shelf, not aboard this hull.
      const shelf = await createGearItem(db, { shopId: shop.id, kind: "aed", label: "AED shelf" });
      if (!shelf.ok) throw new Error("item refused");
      const flares = await createGearItem(db, {
        shopId: shop.id,
        kind: "flares",
        label: "Flares reef",
        aboardBoatId: reef.boatId,
      });
      if (!flares.ok) throw new Error("item refused");
      await recordGearService(db, {
        shopId: shop.id,
        gearItemId: flares.item.id,
        kind: "expiry",
        servicedOn: shiftCalendarDate(today, -900),
        nextDueOn: shiftCalendarDate(today, -3),
      });

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      expect(work.actions.find((a) => a.id === `boat-safety-kit:${reef.id}`)).toMatchObject({
        kind: "boat_safety_kit",
        subject: hull?.name,
        departure: { tripId: reef.id },
        detail: "No AED aboard · Flares reef: expired 3 days ago",
        href: `/shop/${shop.slug}/trips/${reef.id}/manifest`,
      });
      // Said once: not again as the owner's errand, nor as a bench clock.
      expect(work.actions.some((a) => a.id === `boat-safety:kit:${flares.item.id}`)).toBe(false);
      expect(work.actions.some((a) => a.id === `gear-service:${flares.item.id}`)).toBe(false);
    });

    it("is tenant-safe: another shop's queue never sees this fleet", async () => {
      const { db, shop } = ctx;
      const today = calendarDateInTimezone(nowDate(), shop.timezone);
      const item = await createGearItem(db, {
        shopId: shop.id,
        kind: "regulator",
        label: "Reg #90",
      });
      if (!item.ok) throw new Error("item refused");
      await recordGearService(db, {
        shopId: shop.id,
        gearItemId: item.item.id,
        kind: "service",
        servicedOn: shiftCalendarDate(today, -370),
        nextDueOn: shiftCalendarDate(today, -5),
      });

      const otherWork = await getTodayWork(
        db,
        "00000000-0000-4000-8000-000000000000",
        "other-shop",
        shop.timezone,
      );
      expect(otherWork.actions.filter((action) => action.kind.startsWith("gear_"))).toEqual([]);
    });

    it("asks about the bench: a ticket past its promise, and one ready a week and not collected", async () => {
      const { db, shop } = ctx;
      const today = calendarDateInTimezone(nowDate(), shop.timezone);
      const booking = await anySeededBooking(db, shop.id);
      const added = await addCustomerGearItem(db, {
        shopId: shop.id,
        personId: booking.personId,
        kind: "regulator",
        brandModel: "Apeks XTX200",
        serviceDueOn: "",
      });
      const second = await addCustomerGearItem(db, {
        shopId: shop.id,
        personId: booking.personId,
        kind: "bcd",
        brandModel: "",
        serviceDueOn: "",
      });
      if (!added.ok || !second.ok) throw new Error("piece refused");
      const late = await createWorkOrder(db, {
        shopId: shop.id,
        personId: booking.personId,
        customerGearItemIds: [added.item.id],
        reportedProblem: "Free-flows at depth",
        promisedOn: shiftCalendarDate(today, -2),
      });
      const ready = await createWorkOrder(db, {
        shopId: shop.id,
        personId: booking.personId,
        customerGearItemIds: [second.item.id],
        reportedProblem: "Inflator sticks",
      });
      if (!late.ok || !ready.ok) throw new Error("ticket refused");
      const moved = await setWorkOrderStatus(db, {
        shopId: shop.id,
        workOrderId: ready.workOrder.id,
        status: "ready",
      });
      if (!moved.ok) throw new Error("move refused");

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      const lateRow = work.actions.find(
        (action) => action.id === `work-order-late:${late.workOrder.id}`,
      );
      expect(lateRow).toMatchObject({
        kind: "work_order_late",
        urgency: "now",
        href: `/shop/${shop.slug}/gear/work-orders/${late.workOrder.id}`,
        actionLabel: "Open ticket",
      });
      expect(lateRow?.detail).toMatch(/^Promised .+, not ready yet\.$/);
      // Ready today: the customer has a week before anybody chases them.
      expect(work.actions.some((action) => action.kind === "work_order_uncollected")).toBe(false);

      // A week on the shelf is a row.
      await db
        .update(workOrdersTable)
        .set({ readyAt: new Date(nowMs() - 8 * 24 * 60 * 60 * 1000) })
        .where(eq(workOrdersTable.id, ready.workOrder.id));
      const weekOn = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      expect(
        weekOn.actions.find(
          (action) => action.id === `work-order-uncollected:${ready.workOrder.id}`,
        ),
      ).toMatchObject({ kind: "work_order_uncollected", urgency: "later" });

      const otherWork = await getTodayWork(
        db,
        "00000000-0000-4000-8000-000000000000",
        "other-shop",
        shop.timezone,
      );
      expect(otherWork.actions.filter((action) => action.kind.startsWith("work_order_"))).toEqual(
        [],
      );
    });
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
    expect(rows[0]?.subject).toBe("3 messages are waiting on an answer");
  });

  it("grows by one message and renders nothing once every one is answered", async () => {
    const { db, shop } = ctx;
    const recorded = await recordInboundMessage(db, {
      shopId: shop.id,
      channel: "email",
      fromAddress: "someone.new@example.net",
      body: "Do you run night dives?",
      receivedAt: nowDate(),
      providerMessageId: "today-inbox-1",
    });
    if (recorded.status !== "recorded") throw new Error("message not recorded");
    expect((await unansweredRow())[0]?.subject).toBe("4 messages are waiting on an answer");

    const live = await db
      .select({ id: inboundMessages.id })
      .from(inboundMessages)
      .where(and(eq(inboundMessages.shopId, shop.id), isNull(inboundMessages.deletedAt)));
    for (const row of live) await markInboundAnswered(db, shop.id, row.id);

    // Nothing waiting, no row — the queue never carries a zero.
    expect(await unansweredRow()).toHaveLength(0);
  });
});

/**
 * **A crew clash on the surface a shop starts its morning on** (H-80, issues
 * #1776 and #1814).
 *
 * A clash is the one crew fault invisible on both boats: each shows a full crew
 * list. Before the boat sails it is a `crew_clash` row on each departure, read
 * through `crewClashesByTrip` in one batch. After it sails and until it is home
 * it is a `crew_clash_sailed` row — the narrow version H-80 chose, read from the
 * roster rather than from roll-call events, so a shop that never taps a crew
 * roll call still raises no crew roll-call row.
 *
 * Every setup reaches the state the way a shop does: the roster refuses to
 * write an overlap, so the crew go on while the windows are clear and a move
 * lands one boat on the other. A person of the test's own, so a seeded
 * departure cannot clash with them by accident.
 */
describe("crew clashes on Today (H-80)", () => {
  const HOUR = 60 * 60 * 1000;

  async function divemaster(name: string) {
    const { db, shop } = ctx;
    const [person] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: name })
      .returning({ id: people.id });
    if (!person) throw new Error("fixture insert failed");
    await db.insert(personRolesTable).values({ personId: person.id, role: "divemaster" });
    return person.id;
  }

  /**
   * The 09:00-style host (`hostStartsAt` for four hours) and a mover that ties
   * up an hour and a half before it sails, both crewed by one person; then the
   * mover slides to `moveTo`.
   */
  async function movedOnto(hostStartsAt: Date, moveTo: Date) {
    const { db, shop } = ctx;
    const personId = await divemaster("Kai Clashwell");
    const host = await createTrip(db, {
      shopId: shop.id,
      title: "Clash host reef",
      startsAt: hostStartsAt,
      endsAt: new Date(hostStartsAt.getTime() + 4 * HOUR),
      capacity: 6,
    });
    const mover = await createTrip(db, {
      shopId: shop.id,
      title: "Clash mover charter",
      startsAt: new Date(hostStartsAt.getTime() - 3 * HOUR),
      endsAt: new Date(hostStartsAt.getTime() - 1.5 * HOUR),
      capacity: 6,
    });
    if (!host || !mover) throw new Error("departures not created");
    expect(await setTripCrew(db, shop.id, host.id, [personId])).toBe(true);
    expect(await setTripCrew(db, shop.id, mover.id, [personId])).toBe(true);
    expect((await moveTrip(db, shop.id, mover.id, moveTo)).ok).toBe(true);
    return { host, mover, personId };
  }

  /** The shop home's spine for `now`, with no second day to file onto. */
  async function spineAt(now: Date) {
    const { db, shop } = ctx;
    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone, now);
    return assembleDaySpine(work, { departures: [], actions: [] });
  }

  /** The one Needs you list, ranked the way DaySpine ranks it. */
  function needsYou(spine: Awaited<ReturnType<typeof spineAt>>) {
    return sortStationRows([...spine.stations.flatMap((station) => station.rows), ...spine.desk]);
  }

  async function clashRows(now: Date, tripIds: readonly string[]) {
    const { db, shop } = ctx;
    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone, now);
    return work.actions.filter(
      (action) =>
        (action.kind === "crew_clash" || action.kind === "crew_clash_sailed") &&
        tripIds.includes(action.departure?.tripId ?? ""),
    );
  }

  it("raises crew_clash on both departures, naming the person and the other boat", async () => {
    const now = nowDate();
    const hostStartsAt = new Date(now.getTime() + 2 * 24 * HOUR);
    const { host, mover } = await movedOnto(hostStartsAt, hostStartsAt);

    const rows = await clashRows(now, [host.id, mover.id]);
    expect(rows.map((row) => [row.id, row.kind]).sort()).toEqual(
      [
        [`crew-clash:${host.id}`, "crew_clash"],
        [`crew-clash:${mover.id}`, "crew_clash"],
      ].sort(),
    );
    const onMover = rows.find((row) => row.id === `crew-clash:${mover.id}`);
    expect(onMover).toMatchObject({
      aboutDeparture: true,
      urgency: "soon",
      detail: "Kai Clashwell is also rostered on Clash host reef at these hours.",
      href: `/shop/${ctx.shop.slug}/trips/${mover.id}?view=details#crew`,
    });
  });

  it("leaves a crew member handed from one boat to the next alone", async () => {
    const now = nowDate();
    const hostStartsAt = new Date(now.getTime() + 2 * 24 * HOUR);
    // The mover lands so it ties up the minute the host sails: nose to tail.
    const { host, mover } = await movedOnto(
      hostStartsAt,
      new Date(hostStartsAt.getTime() - 1.5 * HOUR),
    );
    expect(await clashRows(now, [host.id, mover.id])).toEqual([]);
  });

  it("ignores a called-off departure on either side", async () => {
    const now = nowDate();
    const hostStartsAt = new Date(now.getTime() + 2 * 24 * HOUR);
    const { host, mover } = await movedOnto(hostStartsAt, hostStartsAt);
    await setTripStatus(ctx.db, ctx.shop.id, host.id, "cancelled");
    expect(await clashRows(now, [host.id, mover.id])).toEqual([]);
  });

  it("says nothing once the clash is cleared", async () => {
    const now = nowDate();
    const hostStartsAt = new Date(now.getTime() + 2 * 24 * HOUR);
    const { host, mover } = await movedOnto(hostStartsAt, hostStartsAt);
    expect(await setTripCrew(ctx.db, ctx.shop.id, mover.id, [])).toBe(true);
    expect(await clashRows(now, [host.id, mover.id])).toEqual([]);
  });

  /**
   * #1814's narrow version: the boat is out with somebody also rostered on
   * another hull. One row, named, pointing at the roll call — and the
   * pre-sailing kind is gone, because there is no "before it sails" left.
   */
  it("raises crew_clash_sailed on a departure underway, and only while it is out", async () => {
    const now = nowDate();
    // Host sailed an hour ago and is out for three more; the mover is slid
    // onto it.
    const hostStartsAt = new Date(now.getTime() - HOUR);
    const { host, mover } = await movedOnto(hostStartsAt, hostStartsAt);

    const rows = await clashRows(now, [host.id, mover.id]);
    expect(rows.map((row) => row.kind)).toEqual(["crew_clash_sailed", "crew_clash_sailed"]);
    const onHost = rows.find((row) => row.departure?.tripId === host.id);
    expect(onHost).toMatchObject({
      id: `crew-clash-sailed:${host.id}`,
      urgency: "imminent",
      aboutDeparture: true,
      detail:
        "Kai Clashwell is out aboard while also rostered on Clash mover charter at these hours. Confirm who is aboard.",
      href: `/shop/${ctx.shop.slug}/trips/${host.id}/manifest`,
    });

    // The mover is a ninety-minute boat: home (a buffered hour past its
    // return) while the host is still out, so only the host still speaks.
    const moverHome = new Date(hostStartsAt.getTime() + 2.6 * HOUR);
    expect((await clashRows(moverHome, [host.id, mover.id])).map((row) => row.id)).toEqual([
      `crew-clash-sailed:${host.id}`,
    ]);
    // Both home: silent. The clash on a returned boat is permanent and
    // unfixable, which is the warning a shop learns to scroll past.
    const bothHome = new Date(hostStartsAt.getTime() + 5.1 * HOUR);
    expect(await clashRows(bothHome, [host.id, mover.id])).toEqual([]);
  });

  /**
   * A clash is decided per leg, not per departure (dive-domain-expert review):
   * a two-day course clashing on its second morning still has the clash to fix
   * while day one is out, a boat out with it on day two, and nothing after.
   */
  it("classifies a multi-day course's clash by the leg it falls on", async () => {
    const { db, shop } = ctx;
    const base = new Date(nowDate().getTime() + 2 * 24 * HOUR);
    const at = (hours: number) => new Date(base.getTime() + hours * HOUR);
    const personId = await divemaster("Rua Twoday");
    const course = await createTrip(db, {
      shopId: shop.id,
      title: "Two-day course",
      startsAt: at(0),
      endsAt: at(28),
      capacity: 4,
      scheduleDays: [
        { dayNumber: 1, startsAt: at(0), endsAt: at(4) },
        { dayNumber: 2, startsAt: at(24), endsAt: at(28) },
      ],
    });
    const charter = await createTrip(db, {
      shopId: shop.id,
      title: "Second-morning charter",
      startsAt: at(10),
      endsAt: at(12),
      capacity: 6,
    });
    if (!course || !charter) throw new Error("departures not created");
    expect(await setTripCrew(db, shop.id, course.id, [personId])).toBe(true);
    expect(await setTripCrew(db, shop.id, charter.id, [personId])).toBe(true);
    expect((await moveTrip(db, shop.id, charter.id, at(25))).ok).toBe(true);

    const onCourse = async (now: Date) =>
      (await clashRows(now, [course.id])).map((row) => [row.kind, row.dueAt?.getTime()]);

    // Day one is out; the clash is on day two, still to sail and still fixable.
    expect(await onCourse(at(1.5))).toEqual([["crew_clash", at(24).getTime()]]);
    // The course started more than an hour ago, so it is no station: the row
    // files at the desk, where Needs you reads it, never into the week's count.
    const dayOne = await spineAt(at(1.5));
    expect(dayOne.stations.map((station) => station.tripId)).not.toContain(course.id);
    expect(needsYou(dayOne).map((row) => row.id)).toContain(`crew-clash:${course.id}`);
    // Day two is out with it.
    expect(await onCourse(at(26))).toEqual([["crew_clash_sailed", at(28).getTime()]]);
    expect(needsYou(await spineAt(at(26))).map((row) => row.id)).toContain(
      `crew-clash-sailed:${course.id}`,
    );
    // Day two is home: permanent, said nowhere.
    expect(await onCourse(at(29.5))).toEqual([]);
  });

  /**
   * A1 of the dive-domain-expert review: a missing diver on the same boat
   * always leads the sailed clash, though both are imminent and the clash's
   * boat may come home first.
   */
  it("dates the sailed clash so a missing diver on a later boat still leads it", async () => {
    const { db, shop } = ctx;
    const now = nowDate();
    const hostStartsAt = new Date(now.getTime() - HOUR);
    const { host } = await movedOnto(hostStartsAt, hostStartsAt);

    // Another boat, out until two hours after the clash boat is home, with a
    // diver counted not back aboard after dive one. Inserted directly: the
    // booking path refuses a seat on a boat that has sailed.
    const [later] = await db
      .insert(tripsTable)
      .values({
        shopId: shop.id,
        title: "Long drift, diver not back",
        startsAt: new Date(now.getTime() - 2 * HOUR),
        endsAt: new Date(host.endsAt.getTime() + 2 * HOUR),
        capacity: 6,
        plannedDives: 2,
        priceCents: 13000,
      })
      .returning();
    if (!later) throw new Error("fixture trip not created");
    const [diver] = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.shopId, shop.id))
      .limit(1);
    const [staff] = await listStaff(db, shop.id);
    if (!diver || !staff) throw new Error("seed people missing");
    const [booking] = await db
      .insert(bookingsTable)
      .values({
        bookedAs: "diver",
        shopId: shop.id,
        tripId: later.id,
        personId: diver.id,
        status: "checked_in",
      })
      .returning();
    if (!booking) throw new Error("fixture booking not created");
    await db.insert(rollCallEventsTable).values({
      shopId: shop.id,
      tripId: later.id,
      bookingId: booking.id,
      recordedByPersonId: staff.person.id,
      status: "boarded",
      checkpoint: "departure",
      source: "live",
      occurredAt: new Date(now.getTime() - 2 * HOUR),
    });
    const counted = await recordRollCall(db, {
      shopId: shop.id,
      tripId: later.id,
      bookingId: booking.id,
      recordedByPersonId: staff.person.id,
      status: "not_boarded",
      checkpoint: "after_dive_1",
    });
    expect(counted.ok).toBe(true);

    const ids = needsYou(await spineAt(now)).map((action) => action.id);
    const missing = ids.findIndex((id) => id.startsWith(`roll-call:${later.id}:missing_diver:`));
    const clash = ids.indexOf(`crew-clash-sailed:${host.id}`);
    expect(missing).toBeGreaterThanOrEqual(0);
    expect(clash).toBeGreaterThan(missing);
  });

  /**
   * B1 of the re-review: a boat that left more than an hour ago is no longer a
   * station, and its sailed clash used to fall into the week's count behind a
   * link. It files at the desk, still naming its boat.
   */
  it("files a sailed clash two hours out at the desk, not into the week's count", async () => {
    const now = nowDate();
    const hostStartsAt = new Date(now.getTime() - 2 * HOUR);
    const { host, mover } = await movedOnto(hostStartsAt, hostStartsAt);
    const { db, shop } = ctx;
    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone, now);
    expect(work.outTripIds).toEqual(expect.arrayContaining([host.id, mover.id]));
    const clashIds = [`crew-clash-sailed:${host.id}`, `crew-clash-sailed:${mover.id}`];
    const spine = assembleDaySpine(
      { ...work, actions: work.actions.filter((action) => clashIds.includes(action.id)) },
      { departures: [], actions: [] },
    );
    expect(spine.desk.map((row) => row.id).sort()).toEqual([...clashIds].sort());
    expect(spine.desk.find((row) => row.id === clashIds[0])?.departure?.tripId).toBe(host.id);
    expect(spine.week.jobs).toBe(0);
  });

  /**
   * N2: "Confirm who is aboard" is answered for a person once they have a
   * result at this departure's own checkpoint, so the row stops naming them.
   */
  it("drops a crew member from the sailed row once the departure roll call has them", async () => {
    const now = nowDate();
    const hostStartsAt = new Date(now.getTime() - 2 * HOUR);
    const { host, mover, personId } = await movedOnto(hostStartsAt, hostStartsAt);
    const { db, shop } = ctx;
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("seed staff missing");
    await recordCrewRollCall(db, {
      shopId: shop.id,
      tripId: host.id,
      personId,
      recordedByPersonId: staff.person.id,
      status: "not_boarded",
      checkpoint: "departure",
    });
    // Answered on the host only: the mover still asks.
    expect((await clashRows(now, [host.id, mover.id])).map((row) => row.id)).toEqual([
      `crew-clash-sailed:${mover.id}`,
    ]);
  });

  it("leaves the roll-call subject rule alone: no crew roll-call row for an untapped crew", async () => {
    const now = nowDate();
    const hostStartsAt = new Date(now.getTime() - HOUR);
    const { host, mover } = await movedOnto(hostStartsAt, hostStartsAt);
    const { db, shop } = ctx;
    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone, now);
    const rollCallCrew = work.actions.filter(
      (action) =>
        (action.kind === "roll_call_missing_crew" || action.kind === "roll_call_crew_unfinished") &&
        [host.id, mover.id].includes(action.departure?.tripId ?? ""),
    );
    expect(rollCallCrew).toEqual([]);
  });
});

describe("staff credentials on Today (one row per staffer)", () => {
  const ctx = fileScopedShopContext();

  it("folds a staffer's lapsing credentials into one row, each with its own date", async () => {
    const { db, shop } = ctx;
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("demo staff missing");
    const today = calendarDateInTimezone(nowDate(), shop.timezone);
    for (const [kind, name, renewsAt] of [
      ["first_aid_cpr", "First aid", shiftCalendarDate(today, -3)],
      ["liability_insurance", "Insurance", shiftCalendarDate(today, 10)],
    ] as const) {
      const made = await createStaffCredential(db, {
        shopId: shop.id,
        personId: staff.person.id,
        kind,
        name,
        renewsAt,
      });
      if (!made) throw new Error("credential refused");
    }

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const rows = work.actions.filter(
      (action) =>
        action.kind === "staff_credential_due" && action.subject === staff.person.fullName,
    );
    expect(rows).toHaveLength(1);
    // Any lapsed credential makes the whole row today's work.
    expect(rows[0]).toMatchObject({ id: `staff-credential:${staff.person.id}`, urgency: "now" });
    expect(rows[0]?.detail).toMatch(/^First aid expired .+\. Insurance renews .+\.$/);
  });
});
