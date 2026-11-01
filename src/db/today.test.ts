import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nowDate, nowMs } from "@/lib/clock";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { shopDayBounds } from "@/lib/zoned";
import { fileScopedShopContext } from "@/test/db";
import { cancelBooking } from "./bookings";
import { getTripManifest, recordCrewRollCall, recordRollCall } from "./manifests";
import { recordNotificationDelivery } from "./notifications";
import { listTripReadiness } from "./readiness";
import { boats, shops as shopsTable, tripAssignments } from "./schema";
import { markShopUnitsConfirmed } from "./shops";
import { getTodayWork } from "./today";
import { recordTripStage } from "./trip-stages";
import {
  createTrip,
  getTripRoster,
  listStaff,
  setTripCrew,
  upcomingTripsWithCounts,
} from "./trips";
import { completeWaiver, issueWaiverRequest } from "./waivers";

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

  /**
   * **Open seats are the seats on sale** (H-20261009-certificate-caps-seats, #2388). The departure states
   * 14 on a hull certified for 12; the booking transaction sells only up to
   * the certificate, so Today counts against it too: the card's open seats,
   * and its readiness bar.
   */
  it("counts a departure's open seats against its boat's certificate, not the stated number", async () => {
    const { db, shop } = ctx;
    const today = (await getTodayWork(db, shop.id, shop.slug, shop.timezone)).departures[0];
    if (!today) throw new Error("expected today's departure");
    const [trip] = (await upcomingTripsWithCounts(db, shop.id)).filter(
      (row) => row.id === today.tripId,
    );
    if (!trip?.boatId) throw new Error("expected today's departure on a boat");
    await db.update(boats).set({ certifiedPassengers: 12 }).where(eq(boats.id, trip.boatId));

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const [departure] = work.departures;
    expect(departure?.capacity).toBe(14);
    expect(departure?.sellableCapacity).toBe(12);
    expect(departure?.booked).toBe(11);
  });

  // Readiness is a safety surface (UX delight sheet 2026-10-22, item 4):
  // naming each diver once may drop nobody the manifest calls blocked, on the
  // boat that carries the most of them.
  it("names every blocked diver on a busy boat exactly once", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const wreck = trips.find((trip) => trip.title === "Wreck Trip — Spiegel Grove");
    if (!wreck) throw new Error("demo wreck trip missing");
    const manifest = await getTripManifest(db, shop.id, wreck.id);
    if (!manifest) throw new Error("expected wreck manifest");
    const blocked = manifest.divers
      .filter((diver) => diver.readiness.status === "blocked")
      .map((diver) => diver.fullName)
      .sort();

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const named = work.actions
      .filter((action) => action.departure?.tripId === wreck.id && action.diver)
      .map((action) => action.subject);

    expect(blocked.length).toBeGreaterThan(1);
    // Once each: no diver is two rows on one boat.
    expect(new Set(named).size).toBe(named.length);
    // Every blocked diver is named; the rest named are divers with other gaps.
    expect(blocked.filter((name) => !named.includes(name))).toEqual([]);
    // No count row stands in for them.
    expect(work.actions.some((action) => action.id.startsWith(`blockers:${wreck.id}`))).toBe(false);
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
    expect(waiverRow(before)?.detail).toBe("Waiver not signed, not sent yet");

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
   * **The stage pill is the crew's word, never the clock's** (UX review
   * 2026-10-10, item 1): a departure nobody has tapped carries no stage, and
   * one the crew says is boarding says Boarding — the word the manifest strip
   * has selected, by the same `boatStageOf`.
   */
  it("gives each departure the crew's stage and nothing the clock made up", async () => {
    const { db, shop } = ctx;
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("demo staff missing");
    const before = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const untapped = before.departures.find((row) => row.stage === null);
    const departure = untapped ?? before.departures[0];
    if (!departure) throw new Error("demo departure missing");

    const recorded = await recordTripStage(db, {
      shopId: shop.id,
      tripId: departure.tripId,
      stage: "boarding",
      recordedByPersonId: staff.person.id,
      recordedAt: nowDate(),
    });
    expect(recorded.ok).toBe(true);

    const after = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(after.departures.find((row) => row.tripId === departure.tripId)?.stage?.stage).toBe(
      "boarding",
    );
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
    // And the third, which the first-run checklist names too (issue #2571).
    expect(row?.subject).toMatch(/Fahrenheit|Celsius/);
    expect(row?.subject).toContain("picked for where you are");
    expect(row?.subject).not.toMatch(/guess/i);

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

  /**
   * **The mark follows the assignment** (fourth review, item 14). The queue's
   * window looks forward, so a boat that sailed this morning with the captain
   * aboard lost its "You're crewing" mark the moment it left, while the
   * afternoon card kept its own.
   */
  it("marks a boat the reader crews that already sailed today", async () => {
    const { db, shop } = ctx;
    const staff = await listStaff(db, shop.id);
    const captain = staff.find((entry) => entry.roles.includes("captain"))?.person;
    if (!captain) throw new Error("seed captain missing");
    const now = nowDate();
    const dayStart = shopDayBounds(now, shop.timezone).from.getTime();
    const startsAt = new Date(Math.max(dayStart + 60_000, now.getTime() - 60 * 60_000));
    const sailed = await createTrip(db, {
      shopId: shop.id,
      title: "Sailed this morning",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3 * 60 * 60_000),
      capacity: 8,
      plannedDives: 1,
    });
    if (!sailed) throw new Error("failed to create the sailed boat");
    await setTripCrew(db, shop.id, sailed.id, [{ personId: captain.id, tripRole: "captain" }]);

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone, undefined, captain.id);
    expect(work.crewedTripIds).toContain(sailed.id);
    // A session list is the window's, and stays so.
    expect(work.crewedSessions.map((session) => session.tripId)).not.toContain(sailed.id);
  });
});

/**
 * **The high-wind row reads the same forecast it always did, asked once per
 * site** (code review 2026-10-10, item 1). The queue used to await the
 * provider one departure at a time inside its loop; it now asks for every
 * booked departure's forecast at once, and the forecast cache shares one
 * request between departures to one site.
 *
 * **And the queue does not wait for it** (code review 2026-10-11, item 1): the
 * rows come back as `highWind`, a promise the page streams under its own
 * `<Suspense>`, so a slow provider holds the wind rows and nothing else.
 */
describe("the high-wind row (issue #722)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Every provider request answers the same hour-by-hour wind, wherever it is asked. */
  function stubProvider(windKnots: number) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      const start = Math.floor(nowMs() / 3_600_000) * 3_600;
      const time = Array.from({ length: 24 * 10 }, (_, hour) => start + hour * 3_600);
      const body =
        url.hostname === "marine-api.open-meteo.com"
          ? { hourly: { time, wave_height: time.map(() => 0.4) } }
          : { hourly: { time, wind_speed_10m: time.map(() => windKnots) } };
      return new Response(JSON.stringify(body));
    });
  }

  it("raises the row on a windy forecast and asks each provider once per site", async () => {
    const { db, shop } = ctx;
    const fetcher = stubProvider(30);

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);

    expect(work.actions.filter((action) => action.kind === "high_wind_alert")).toEqual([]);
    const windRows = await work.highWind;
    expect(windRows.length).toBeGreaterThan(0);
    expect(windRows.every((action) => action.kind === "high_wind_alert")).toBe(true);
    expect(windRows[0]).toMatchObject({ urgency: "now", aboutDeparture: true });
    const urls = fetcher.mock.calls.map(([input]) => String(input));
    expect(urls.length).toBeGreaterThan(0);
    // One request per provider per site, however many departures sail there.
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("asks the provider for nothing when the caller says it will not read the wind rows", async () => {
    const { db, shop } = ctx;
    const fetcher = stubProvider(30);

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
      undefined,
      undefined,
      false,
    );

    expect(await work.highWind).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("raises nothing on a calm forecast", async () => {
    const { db, shop } = ctx;
    stubProvider(8);

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);

    expect(await work.highWind).toEqual([]);
  });

  it("answers the queue while the provider has still said nothing", async () => {
    const { db, shop } = ctx;
    let answer: (response: Response) => void = () => {};
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => new Promise<Response>((resolve) => (answer = resolve)));

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);

    // The queue is whole without the forecast; only the wind rows wait.
    expect(fetcher).toHaveBeenCalled();
    expect(work.actions.length).toBeGreaterThan(0);
    let settled = false;
    void work.highWind.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    answer(new Response("{}", { status: 503 }));
  });

  it("hands a provider failure back as no rows, never a rejection", async () => {
    const { db, shop } = ctx;
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);

    await expect(work.highWind).resolves.toEqual([]);
  });

  it("raises the row only for the roles that see it", async () => {
    const { db, shop } = ctx;
    stubProvider(30);

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
      undefined,
      ["crew"],
    );

    expect(await work.highWind).toEqual([]);
  });
});
