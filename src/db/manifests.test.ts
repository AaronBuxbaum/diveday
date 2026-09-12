import { and, asc, eq, inArray } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { ageOnDate, birthdayCallout } from "@/lib/age";
import { STAFF_ROLES } from "@/lib/authz";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate, nowMs } from "@/lib/clock";
import { log } from "@/lib/log";
import {
  isRollCallAccountedFor,
  type RollCallCheckpoint,
  rollCallCompleteness,
} from "@/lib/manifests";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { serializeManifests } from "@/lib/offline-manifests";
import { isWaiverCode } from "@/lib/today";
import { createWaiverToken, hashWaiverToken } from "@/lib/waiver-tokens";
import { seededShopContext } from "@/test/db";
import { subscribeManifestEvents } from "./manifest-events";
import {
  departureRollCallForBooking,
  getTripManifest,
  getTripManifests,
  listDepartureBoardedBookingIds,
  listDepartureBoardedByTrip,
  onTheWaterByRollCall,
  recordCrewRollCall,
  recordRollCall,
} from "./manifests";
import { markBookingNoShow } from "./no-show";
import {
  activityEvents,
  bookings,
  people,
  personRoles,
  rollCallCrewEvents,
  rollCallEvents,
  shops,
  tripAssignments,
  trips,
  userAccounts,
  waiverRecords,
} from "./schema";
import { listRollCallGaps } from "./today";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";
import { completeWaiver, getCurrentWaiverTemplate, issueWaiverRequest } from "./waivers";

vi.mock("@/lib/log", () => ({ log: vi.fn() }));

const clearAnswers = emptyMedicalAnswers(RSTC_QUESTIONNAIRE);

/** One booking's status, for the seat a no-show releases and a boarding takes back. */
async function statusOf(db: Awaited<ReturnType<typeof manifestContext>>["db"], bookingId: string) {
  const [row] = await db
    .select({ status: bookings.status })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  return row?.status;
}

/** Every code on this booking's trail. */
async function activityCodesFor(
  db: Awaited<ReturnType<typeof manifestContext>>["db"],
  bookingId: string,
) {
  const rows = await db
    .select({ code: activityEvents.code, occurredAt: activityEvents.occurredAt })
    .from(activityEvents)
    .where(eq(activityEvents.bookingId, bookingId))
    .orderBy(asc(activityEvents.occurredAt), asc(activityEvents.id));
  return rows.map((row) => row.code);
}

async function manifestContext() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const [booking] = await getTripRoster(db, shop.id, reef.id);
  if (!booking) throw new Error("demo booking missing");
  const template = await getCurrentWaiverTemplate(db, shop.id);
  if (!template) throw new Error("demo waiver template missing");
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("demo staff missing");
  return { db, shop, reef, booking, template, staff: staff.person };
}

/**
 * **Deliberately still on per-test hydration** (issue #1244). Two tests here —
 * "resolves a same-transaction, same-timestamp pair to the later-appended
 * event", for bookings and for crew — have transaction semantics as their
 * *subject*: they open their own transaction so a pair of roll-call rows share
 * one `now()`, then assert the append-order tie-break. Under
 * `fileScopedShopContext` that inner transaction becomes a savepoint and the
 * outer one has already frozen `now()`, so *every* row in the test would carry
 * the same timestamp and the pair would stop being the thing under test. The
 * assertion would still pass, and prove less.
 */
describe("trip manifest and roll call (in-memory PGlite)", () => {
  it("derives every active booking into the manifest, including blocked divers", async () => {
    // The reef trip (manifestContext's fixture) is mostly ready these days —
    // most divers sign their waiver before the boat leaves. The night dive
    // stays universally blocked instead: none of its divers carry the Night
    // specialty the trip requires, regardless of waiver status.
    const { db, shop } = await manifestContext();
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const night = trips.find((trip) => trip.title.startsWith("Night Dive — City of Washington"));
    if (!night) throw new Error("demo night trip missing");
    const roster = await getTripRoster(db, shop.id, night.id);
    const manifest = await getTripManifest(db, shop.id, night.id);

    expect(manifest?.divers).toHaveLength(roster.length);
    expect(manifest?.summary.blocked).toBe(roster.length);
    expect(manifest?.divers.every((diver) => diver.readiness.status === "blocked")).toBe(true);
  });

  it("only records boarding after the shared readiness service clears the diver", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.booking.id,
    });
    if (!issued.ok) throw new Error("expected waiver link");
    await completeWaiver(db, issued.token, {
      signerName: booking.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });

    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        status: "boarded",
      }),
    ).resolves.toMatchObject({ ok: true });

    const manifest = await getTripManifest(db, shop.id, reef.id);
    const diver = manifest?.divers.find((entry) => entry.bookingId === booking.booking.id);
    expect(diver).toMatchObject({
      readiness: { status: "ready" },
      rollCall: { state: "boarded", recordedByName: staff.fullName },
    });
  });

  /**
   * **The desk said not here; the crew says aboard. The crew wins, and the seat
   * comes back with them** (security and dive-domain review 20260911).
   *
   * `markBookingNoShow` releases the seat on the confirm tap — `no_show` leaves
   * `SEAT_HELD_STATUSES`, so a walk-in can buy it. Nothing on the boarding path
   * read booking status: readiness does not, and `getTripRoster` drops only
   * cancelled rows, so the released seat stayed on the manifest as a tappable
   * name and boarding it put capacity plus one on the water with the seat count
   * still saying the boat was full at capacity. The tap is not refused — a crew
   * member looking at a body is the best evidence this product has — so it
   * takes the release back instead.
   */
  it("takes a released seat back when the crew board the diver the counter wrote off", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.booking.id });
    if (!issued.ok) throw new Error("expected waiver link");
    await completeWaiver(db, issued.token, {
      signerName: booking.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });

    expect(
      await markBookingNoShow(db, {
        shopId: shop.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        now: reef.startsAt,
      }),
    ).toMatchObject({ ok: true });
    expect(await statusOf(db, booking.booking.id)).toBe("no_show");

    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        status: "boarded",
      }),
    ).resolves.toMatchObject({ ok: true });

    expect(await statusOf(db, booking.booking.id)).toBe("booked");
    // The trail keeps both taps, and the second one is its own line: "who
    // released this seat, and who took it back" is asked at a desk with a
    // stranger standing at it. (The demo booking arrives with a trail of its
    // own, so this asks what was added rather than what the whole list is.)
    expect(await activityCodesFor(db, booking.booking.id)).toEqual(
      expect.arrayContaining(["booking_no_show", "booking_no_show_boarded"]),
    );
  });

  /**
   * **The same ordering when the crew get there second, for the statement that
   * is not a boarding** (dive-domain-expert review, issue #1704).
   *
   * `noShowGate` refuses the desk when the crew have already recorded a diver
   * as not back aboard. For one slice the mirror act covered only `boarded`, so
   * the desk-first ordering left a `no_show` standing over a diver in the
   * water: the seat had left `SEAT_HELD_STATUSES` at the desk's tap, the
   * counter had already offered it to the wait list, and the glossary's promise
   * that the mark "cannot co-exist with a boarding at any checkpoint" was
   * false.
   *
   * Not the unlucky ordering — the expected one. The desk's door is open for
   * six hours after departure, and the offline manifest exists precisely
   * because after-dive marks are made with no signal and sync hours later.
   */
  it("takes a released seat back when the crew record the diver missing after a dive", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();

    expect(
      await markBookingNoShow(db, {
        shopId: shop.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        now: reef.startsAt,
      }),
    ).toMatchObject({ ok: true });
    expect(await statusOf(db, booking.booking.id)).toBe("no_show");

    // No waiver on this seat, deliberately: readiness gates the boarded tap at
    // the dock and nothing else, so "did not come back from dive one" is
    // recordable on a diver whose paperwork never cleared.
    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        status: "not_boarded",
        checkpoint: "after_dive_1",
      }),
    ).resolves.toMatchObject({ ok: true });

    expect(await statusOf(db, booking.booking.id)).toBe("booked");
    // **Its own trail line.** At 18:00 "the boat carried somebody the desk had
    // written off" and "the desk wrote off somebody the crew then reported
    // missing" are the two facts an owner has to tell apart, and only one of
    // them is still an open question.
    const codes = await activityCodesFor(db, booking.booking.id);
    expect(codes).toEqual(
      expect.arrayContaining(["booking_no_show", "booking_no_show_missing_after_dive"]),
    );
    expect(codes).not.toContain("booking_no_show_boarded");
  });

  /**
   * **And the dock's own `not_boarded` still does not**, which is the asymmetry
   * the whole fix rests on: there the word means "never left the dock", so the
   * crew are agreeing with the desk rather than contradicting it. A rule that
   * read `not_boarded` without its checkpoint would undo every walk-away the
   * desk ever recorded.
   */
  it("leaves the release alone when the crew mark the diver ashore at the dock", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();

    expect(
      await markBookingNoShow(db, {
        shopId: shop.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        now: reef.startsAt,
      }),
    ).toMatchObject({ ok: true });

    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        status: "not_boarded",
      }),
    ).resolves.toMatchObject({ ok: true });

    expect(await statusOf(db, booking.booking.id)).toBe("no_show");
    expect(await activityCodesFor(db, booking.booking.id)).not.toContain(
      "booking_no_show_missing_after_dive",
    );
  });

  /**
   * Releasing a seat is the desk's act, with its own gate and its own confirm
   * tap. A mis-tap at the rail corrects the head count; it must never sell a
   * diver's seat out from under them.
   */
  it("does not release the seat again when the crew correct a boarding", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.booking.id });
    if (!issued.ok) throw new Error("expected waiver link");
    await completeWaiver(db, issued.token, {
      signerName: booking.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });
    await markBookingNoShow(db, {
      shopId: shop.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      now: reef.startsAt,
    });
    const board = {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
    };
    await recordRollCall(db, { ...board, status: "boarded" });

    await expect(recordRollCall(db, { ...board, status: "not_boarded" })).resolves.toMatchObject({
      ok: true,
    });

    expect(await statusOf(db, booking.booking.id)).toBe("booked");
  });

  /**
   * **The manifest says which of its names the desk wrote off** (#1209,
   * `dive-domain-expert` review 20260911).
   *
   * The roster keeps every non-cancelled booking on purpose, so a released
   * seat is still a row — and until this flag it was a row indistinguishable
   * from a diver still walking down the dock, because `checkedIn` was the only
   * booking signal the manifest carried. The crew then count heads against a
   * name the counter settled. Boarding takes the release back, which is why
   * the flag has to come off the same read rather than from a rule of its own.
   */
  it("marks the counter's released seat on the manifest, and unmarks it when the rail boards them", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.booking.id });
    if (!issued.ok) throw new Error("expected waiver link");
    await completeWaiver(db, issued.token, {
      signerName: booking.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });
    const diverOn = async () =>
      (await getTripManifest(db, shop.id, reef.id))?.divers.find(
        (diver) => diver.bookingId === booking.booking.id,
      );
    expect(await diverOn()).toMatchObject({ notHere: false });

    await markBookingNoShow(db, {
      shopId: shop.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      now: reef.startsAt,
    });

    expect(await diverOn()).toMatchObject({ notHere: true });
    // Nobody at the boat has spoken for them yet, so they are the one name in
    // the head count's denominator that is not a body to expect. They stay in
    // `awaiting`: the crew's statement is still what closes the checkpoint.
    expect((await getTripManifest(db, shop.id, reef.id))?.summary).toMatchObject({ notHere: 1 });

    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        status: "boarded",
      }),
    ).resolves.toMatchObject({ ok: true });

    expect(await diverOn()).toMatchObject({ notHere: false });
    expect((await getTripManifest(db, shop.id, reef.id))?.summary).toMatchObject({ notHere: 0 });
  });

  /**
   * The seat comes back even when it is the seat the shop has already sold.
   * Refusing would leave a person aboard whom the manifest does not carry, so
   * the boat being over is *said* instead — `summary.overCapacity`, the one
   * number on the page that reports what nothing refused.
   */
  it("boards a diver onto a full boat and raises the over-capacity count instead", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.booking.id });
    if (!issued.ok) throw new Error("expected waiver link");
    await completeWaiver(db, issued.token, {
      signerName: booking.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });
    await markBookingNoShow(db, {
      shopId: shop.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      now: reef.startsAt,
    });
    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        status: "boarded",
      }),
    ).resolves.toMatchObject({ ok: true });

    // Everyone else readiness clears, aboard too — counted rather than assumed,
    // so this stays about capacity whatever the demo roster's paperwork says.
    let aboard = 1;
    for (const row of await getTripRoster(db, shop.id, reef.id)) {
      if (row.booking.id === booking.booking.id) continue;
      const result = await recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: row.booking.id,
        recordedByPersonId: staff.id,
        status: "boarded",
      });
      if (result.ok) aboard += 1;
    }

    await db.update(trips).set({ capacity: aboard }).where(eq(trips.id, reef.id));
    expect((await getTripManifest(db, shop.id, reef.id))?.summary).toMatchObject({
      boarded: aboard,
      overCapacity: 0,
    });
    // The walk-in holds the released seat, so the boat seats one fewer than the
    // crew have counted aboard. Nothing refused that; this is what says it.
    await db
      .update(trips)
      .set({ capacity: aboard - 1 })
      .where(eq(trips.id, reef.id));
    expect((await getTripManifest(db, shop.id, reef.id))?.summary.overCapacity).toBe(1);
  });

  it("answers 'who is aboard' the same way for the counter and for the departure board", async () => {
    // One reader, two shapes. `boardedCountsByTrip` (src/db/today.ts) used to
    // be a second hand-written copy of this query, and the copies had already
    // drifted: only one of them carried the cancelled-booking guard. Both
    // derive from `listDepartureBoardedByTrip` now, so a head count and a
    // per-diver badge can no longer disagree about the same booking.
    const { db, shop, reef, booking, staff } = await manifestContext();
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.booking.id,
    });
    if (!issued.ok) throw new Error("expected waiver link");
    await completeWaiver(db, issued.token, {
      signerName: booking.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });
    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        status: "boarded",
      }),
    ).resolves.toMatchObject({ ok: true });

    const byTrip = await listDepartureBoardedByTrip(db, shop.id, [reef.id]);
    const flat = await listDepartureBoardedBookingIds(db, shop.id, [reef.id]);
    expect(byTrip.get(reef.id)?.has(booking.booking.id)).toBe(true);
    expect(flat.has(booking.booking.id)).toBe(true);
    // The flat reader is exactly the grouped one, flattened — never its own query.
    expect(flat.size).toBe([...byTrip.values()].reduce((sum, set) => sum + set.size, 0));

    // A seat pulled after the count keeps its roll-call row. Counting it would
    // let the head count agree with `booked` while a real diver is still
    // ashore — the failure this guard exists to stop.
    await db
      .update(bookings)
      .set({ status: "cancelled" })
      .where(eq(bookings.id, booking.booking.id));

    const afterCancel = await listDepartureBoardedByTrip(db, shop.id, [reef.id]);
    const afterCancelFlat = await listDepartureBoardedBookingIds(db, shop.id, [reef.id]);
    expect(afterCancel.get(reef.id)?.has(booking.booking.id) ?? false).toBe(false);
    expect(afterCancelFlat.has(booking.booking.id)).toBe(false);
  });

  it("drops a boarding that was undone, for both shapes of the aboard reader", async () => {
    // A later `cleared` is staff undoing a mistake, not a boarding that stands
    // — the same "latest event, not latest boarded event" rule the manifest
    // itself applies.
    const { db, shop, reef, booking, staff } = await manifestContext();
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.booking.id,
    });
    if (!issued.ok) throw new Error("expected waiver link");
    await completeWaiver(db, issued.token, {
      signerName: booking.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      status: "boarded",
    });
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      status: "cleared",
    });

    const byTrip = await listDepartureBoardedByTrip(db, shop.id, [reef.id]);
    const flat = await listDepartureBoardedBookingIds(db, shop.id, [reef.id]);
    expect(byTrip.get(reef.id)?.has(booking.booking.id) ?? false).toBe(false);
    expect(flat.has(booking.booking.id)).toBe(false);
  });

  it("answers one seat's own departure result, for the diver's own page", async () => {
    // `departureRollCallForBooking` is what keeps the thread's after-state
    // from asserting that somebody dived on the strength of a clock
    // (`isAfterTheDive`, src/lib/thread-steps.ts). Null is the ordinary answer
    // — plenty of shops record nothing — and it is the answer that makes that
    // page wait for the four-hour recap floor instead of opening at the
    // one-hour late-arrival buffer.
    const { db, shop, reef, booking, staff } = await manifestContext();
    expect(await departureRollCallForBooking(db, shop.id, reef.id, booking.booking.id)).toBeNull();

    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.booking.id,
    });
    if (!issued.ok) throw new Error("expected waiver link");
    await completeWaiver(db, issued.token, {
      signerName: booking.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      status: "not_boarded",
    });
    expect(await departureRollCallForBooking(db, shop.id, reef.id, booking.booking.id)).toBe(
      "not_boarded",
    );

    // The newest event wins, exactly as it does for the roster readers above.
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      status: "boarded",
    });
    expect(await departureRollCallForBooking(db, shop.id, reef.id, booking.booking.id)).toBe(
      "boarded",
    );
  });

  it("answers whether the crew put a seat on the water at any checkpoint", async () => {
    // The counter's `already_boarded` refusal reads this rather than the dock
    // alone: a diver who joined at the second site has no departure event at
    // all, and the desk must not be able to call them absent
    // (`inAfterDivePopulation`, src/db/today.ts).
    const { db, shop, reef, booking, staff } = await manifestContext();
    expect(await onTheWaterByRollCall(db, shop.id, reef.id, booking.booking.id)).toBeNull();

    // No waiver: readiness gates boarding at the dock only, so an after-dive
    // head count takes the diver as they are.
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      status: "boarded",
      checkpoint: "after_dive_1",
    });
    expect(await onTheWaterByRollCall(db, shop.id, reef.id, booking.booking.id)).toBe("boarded");
    expect(await departureRollCallForBooking(db, shop.id, reef.id, booking.booking.id)).toBeNull();

    // And a `cleared` undo drops it back out, the same supersession every other
    // reader here applies — there is then nothing standing anywhere.
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      status: "cleared",
      checkpoint: "after_dive_1",
    });
    expect(await onTheWaterByRollCall(db, shop.id, reef.id, booking.booking.id)).toBeNull();
  });

  /**
   * **`not_boarded` means opposite things at the two kinds of checkpoint, and
   * this reader is the one place that difference is decided** (issue #1704).
   *
   * At `departure` it is "never left the dock" — the benign half, and the
   * ordinary absence the counter exists to record. At `after_dive_n` it is "did
   * not come back from the dive", which is the missing-diver row
   * (`isAccountedForAfterDive`, src/db/today.ts; **sailed** in the glossary).
   * A reader that ignored the checkpoint would be wrong in the direction that
   * stops a shop doing its work: every walk-away carries a dock `not_boarded`,
   * so the desk could never release a seat again.
   */
  it("reads a not_boarded as the water only after a dive, never at the dock", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    const seatId = booking.booking.id;

    // The dock's own "never left": no waiver needed, since readiness gates the
    // boarded tap and not this one.
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: seatId,
      recordedByPersonId: staff.id,
      status: "not_boarded",
    });
    expect(await departureRollCallForBooking(db, shop.id, reef.id, seatId)).toBe("not_boarded");
    expect(await onTheWaterByRollCall(db, shop.id, reef.id, seatId)).toBeNull();

    // That dock result is the only row this seat has, and it stays false: the
    // trap this reader is built to avoid is composing on
    // `carryForwardNotBoarded` (src/lib/roll-call.ts), which reports the
    // carried default as a result at `after_dive_1` and would make every
    // walk-away permanently un-markable. Persisted rows only — `implied` is
    // never stored.

    // "Did not come back from dive one" is the opposite fact, and the crew can
    // record it whatever the dock said.
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: seatId,
      recordedByPersonId: staff.id,
      status: "not_boarded",
      checkpoint: "after_dive_1",
    });
    expect(await onTheWaterByRollCall(db, shop.id, reef.id, seatId)).toBe("missing_after_dive");

    // A `cleared` at that checkpoint is the crew undoing a mistake, so nothing
    // stands there any more and the dock's own result still does not count.
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: seatId,
      recordedByPersonId: staff.id,
      status: "cleared",
      checkpoint: "after_dive_1",
    });
    expect(await onTheWaterByRollCall(db, shop.id, reef.id, seatId)).toBeNull();
  });

  /**
   * **A staffer who dives, and the half of the head count the diver table
   * cannot see** (dive-domain-expert review, issue #1704).
   *
   * On a shop where staff dive too, one person can be on `trip_assignments`
   * *and* hold a seat on the same departure. Their crew result lives in
   * `roll_call_crew_events`, keyed on the person rather than the booking, so a
   * reader of the diver trail alone answered "nothing stands" about a human the
   * crew half of the head count had recorded as not back aboard — and the desk
   * could mark that seat absent. Missing crew is severity 2 in this product's
   * own ranking, above a missing diver, on the grounds that the crew are the
   * people most reliably in the water.
   */
  it("reads the crew roll call for a staffer holding a seat on a trip they crew", async () => {
    const { db, shop, reef, staff } = await manifestContext();
    await db
      .insert(tripAssignments)
      .values({ tripId: reef.id, personId: staff.id })
      .onConflictDoNothing();
    const [seat] = await db
      .insert(bookings)
      .values({ shopId: shop.id, tripId: reef.id, personId: staff.id, status: "booked" })
      .returning({ id: bookings.id });
    if (!seat) throw new Error("expected the crew member's own seat");

    // Nothing in either trail yet.
    expect(await onTheWaterByRollCall(db, shop.id, reef.id, seat.id)).toBeNull();

    await expect(
      recordCrewRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        personId: staff.id,
        recordedByPersonId: staff.id,
        status: "not_boarded",
        checkpoint: "after_dive_1",
      }),
    ).resolves.toMatchObject({ ok: true });

    expect(await onTheWaterByRollCall(db, shop.id, reef.id, seat.id)).toBe("missing_after_dive");
    // And the desk is refused on that seat, which is the whole point of the
    // second read: the refusal is what stops the release.
    expect(
      await markBookingNoShow(db, {
        shopId: shop.id,
        bookingId: seat.id,
        recordedByPersonId: staff.id,
        now: reef.startsAt,
      }),
    ).toEqual({ ok: false, reason: "already_missing_after_dive" });
  });

  /**
   * The crew counterpart of the dock asymmetry: at `departure` the crew's
   * `not_boarded` means the staffer never sailed, so their own seat is an
   * ordinary absence the desk may still record.
   */
  it("leaves a crew member's seat markable when the crew mark them ashore at the dock", async () => {
    const { db, shop, reef, staff } = await manifestContext();
    await db
      .insert(tripAssignments)
      .values({ tripId: reef.id, personId: staff.id })
      .onConflictDoNothing();
    const [seat] = await db
      .insert(bookings)
      .values({ shopId: shop.id, tripId: reef.id, personId: staff.id, status: "booked" })
      .returning({ id: bookings.id });
    if (!seat) throw new Error("expected the crew member's own seat");

    await expect(
      recordCrewRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        personId: staff.id,
        recordedByPersonId: staff.id,
        status: "not_boarded",
      }),
    ).resolves.toMatchObject({ ok: true });

    expect(await onTheWaterByRollCall(db, shop.id, reef.id, seat.id)).toBeNull();
  });

  it("carries the counter check-in status onto the manifest, independent of roll call (task 149)", async () => {
    // Counter check-in and boat roll call are two different questions —
    // arrived vs. aboard. `checked_in` used to have exactly one reader in
    // the app (the check-in page itself); the manifest never showed it.
    const { db, shop, reef, booking } = await manifestContext();

    const beforeCheckIn = await getTripManifest(db, shop.id, reef.id);
    expect(
      beforeCheckIn?.divers.find((entry) => entry.bookingId === booking.booking.id)?.checkedIn,
    ).toBe(false);

    await db
      .update(bookings)
      .set({ status: "checked_in" })
      .where(eq(bookings.id, booking.booking.id));

    const afterCheckIn = await getTripManifest(db, shop.id, reef.id);
    const diver = afterCheckIn?.divers.find((entry) => entry.bookingId === booking.booking.id);
    // Checked in at the counter, but never boarded — the two states stay
    // independent rather than one implying the other.
    expect(diver?.checkedIn).toBe(true);
    expect(diver?.rollCall).toBeUndefined();
  });

  it("carries an imported waiver's medical mark onto the manifest, distinctly from a real review (ADR 20260724-import-waiver-acceptance)", async () => {
    const { db, shop, reef, booking, template } = await manifestContext();
    const now = nowDate();
    await db.insert(waiverRecords).values({
      shopId: shop.id,
      bookingId: null,
      personId: booking.person.id,
      templateId: template.id,
      templateTitle: template.title,
      templateVersion: template.version,
      templateBody: template.body,
      status: "completed",
      tokenHash: hashWaiverToken(createWaiverToken()),
      expiresAt: now,
      signedName: booking.person.fullName,
      signatureMethod: "imported",
      consentedAt: now,
      signedAt: now,
      medicalReviewRequired: false,
      completedAt: now,
      importedFromLabel: "Old Blue Reef Divers",
    });

    const manifest = await getTripManifest(db, shop.id, reef.id);
    const diver = manifest?.divers.find((entry) => entry.bookingId === booking.booking.id);
    // The manifest is the surface a crew reads for a go/no-go call — an
    // imported acceptance must be visibly distinct from a real DiveDay
    // review, never folded into the same "digital" label.
    expect(diver?.medicalWaiver).toMatchObject({ source: "imported" });
    expect(diver?.readiness.blockers.some((b) => isWaiverCode(b.code))).toBe(false);
  });

  it("allows an explicit not-boarded record but refuses to board blocked evidence", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        status: "boarded",
      }),
    ).resolves.toEqual({ ok: false, reason: "not_ready" });
    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        status: "not_boarded",
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("boards a diver whose readiness lapsed after departure at an after-dive head count", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    // The seed reef trip's first-booked diver has no waiver on file at all
    // (the rest have one pending, still blocked). At departure the readiness
    // gate refuses to board a blocked diver.
    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        status: "boarded",
        checkpoint: "departure",
      }),
    ).resolves.toEqual({ ok: false, reason: "not_ready" });

    // An after-dive checkpoint is a head count of bodies on the boat, so the same
    // blocked diver can be recorded present — the "everyone accounted for" count
    // must never exclude a diver who is demonstrably aboard.
    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        status: "boarded",
        checkpoint: "after_dive_1",
      }),
    ).resolves.toMatchObject({ ok: true });

    const afterDive = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
    expect(
      afterDive?.divers.find((entry) => entry.bookingId === booking.booking.id)?.rollCall?.state,
    ).toBe("boarded");
  });

  it("keeps departure and after-dive head counts independent", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.booking.id,
    });
    if (!issued.ok) throw new Error("expected waiver link");
    await completeWaiver(db, issued.token, {
      signerName: booking.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });

    await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      status: "boarded",
      checkpoint: "departure",
      occurredAt: new Date("2026-07-20T11:00:00.000Z"),
    });

    const departure = await getTripManifest(db, shop.id, reef.id, "departure");
    const afterDive = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
    expect(
      departure?.divers.find((entry) => entry.bookingId === booking.booking.id)?.rollCall?.state,
    ).toBe("boarded");
    expect(
      afterDive?.divers.find((entry) => entry.bookingId === booking.booking.id)?.rollCall,
    ).toBeUndefined();
  });

  it("clears a recorded roll call back to awaiting when staff tap the status again", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      status: "not_boarded",
      occurredAt: new Date("2026-07-20T11:00:00.000Z"),
    });
    const marked = await getTripManifest(db, shop.id, reef.id);
    expect(
      marked?.divers.find((entry) => entry.bookingId === booking.booking.id)?.rollCall?.state,
    ).toBe("not_boarded");

    await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      status: "cleared",
      occurredAt: new Date("2026-07-20T11:05:00.000Z"),
    });
    const cleared = await getTripManifest(db, shop.id, reef.id);
    expect(
      cleared?.divers.find((entry) => entry.bookingId === booking.booking.id)?.rollCall,
    ).toBeUndefined();
  });

  it("defaults later checkpoints to not boarded once a diver is left off", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      status: "not_boarded",
      checkpoint: "departure",
      occurredAt: new Date("2026-07-20T11:00:00.000Z"),
    });
    const afterDive = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
    expect(
      afterDive?.divers.find((entry) => entry.bookingId === booking.booking.id)?.rollCall,
    ).toMatchObject({ state: "not_boarded", implied: true });
  });

  it("applies an offline event once and rejects a delayed event behind newer live history", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.booking.id,
    });
    if (!issued.ok) throw new Error("expected waiver link");
    await completeWaiver(db, issued.token, {
      signerName: booking.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });

    const now = nowMs();
    const offlineInput = {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      status: "boarded" as const,
      checkpoint: "after_dive_1" as const,
      source: "offline" as const,
      clientEventId: "11111111-1111-4111-8111-111111111111",
      offlineSnapshotSavedAt: new Date(now - 2 * 60 * 60 * 1000),
      occurredAt: new Date(now - 60 * 60 * 1000),
    };
    const first = await recordRollCall(db, offlineInput);
    const duplicate = await recordRollCall(db, offlineInput);
    expect(first).toMatchObject({ ok: true });
    expect(duplicate).toMatchObject({ ok: true, duplicate: true });
    expect(
      (await db.select().from(rollCallEvents)).filter(
        (event) => event.clientEventId === offlineInput.clientEventId,
      ),
    ).toHaveLength(1);

    await recordRollCall(db, {
      ...offlineInput,
      source: "live",
      clientEventId: undefined,
      offlineSnapshotSavedAt: undefined,
      status: "not_boarded",
      occurredAt: new Date(now - 10 * 60 * 1000),
    });
    await expect(
      recordRollCall(db, {
        ...offlineInput,
        clientEventId: "22222222-2222-4222-8222-222222222222",
        occurredAt: new Date(now - 30 * 60 * 1000),
      }),
    ).resolves.toEqual({ ok: false, reason: "newer_event_exists" });
  });

  /**
   * The server half of the equal-timestamp tie rule, which the device's
   * `latestQueuedAttempt` (src/lib/offline-manifests.ts) is written to match.
   *
   * The refusal above is `newest.occurredAt > occurredAt` — strictly newer — so
   * an *equal* timestamp is deliberately accepted rather than refused as
   * `newer_event_exists`, and the read-back's `desc(occurredAt), desc(createdAt)`
   * then returns the later-applied row. That is what lets a captain who marked
   * the wrong row and corrected it inside one millisecond keep the correction.
   *
   * Pinned here because nothing else does. Tighten this comparison to `>=` and
   * the server starts refusing the correction: the device would show the fix,
   * the sync would reject it, and the reader would fall through to the
   * snapshot — leaving "awaiting" on a person somebody had just made a
   * statement about, with every device-side test still green.
   */
  it("accepts an equal-timestamp offline correction, and reads back the later one", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.booking.id,
    });
    if (!issued.ok) throw new Error("expected waiver link");
    await completeWaiver(db, issued.token, {
      signerName: booking.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });

    const now = nowMs();
    // One instant, two taps. `occurredAt` is millisecond-resolution, and the
    // e2e fleet's frozen clock makes this the normal case rather than the edge.
    const occurredAt = new Date(now - 60 * 60 * 1000);
    const base = {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      checkpoint: "after_dive_1" as const,
      source: "offline" as const,
      offlineSnapshotSavedAt: new Date(now - 2 * 60 * 60 * 1000),
      occurredAt,
    };

    // The mistake.
    await expect(
      recordRollCall(db, {
        ...base,
        status: "not_boarded",
        clientEventId: "33333333-3333-4333-8333-333333333333",
      }),
    ).resolves.toMatchObject({ ok: true });
    // The correction, one tap later and the same millisecond. Accepted, not
    // refused as newer_event_exists — this is the assertion that matters.
    await expect(
      recordRollCall(db, {
        ...base,
        status: "boarded",
        clientEventId: "44444444-4444-4444-8444-444444444444",
      }),
    ).resolves.toMatchObject({ ok: true });

    const manifest = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
    expect(
      manifest?.divers.find((diver) => diver.bookingId === booking.booking.id)?.rollCall,
    ).toMatchObject({ state: "boarded" });
  });

  /**
   * The compare-and-set (ADR 20260815-an-offline-retraction-names-its-target).
   *
   * `newest.occurredAt > occurredAt` is a timestamp comparison, and a retraction
   * is stamped at tap time — so a `cleared` tapped *now* on a device holding a
   * stale copy beat everything recorded before now, including another device's
   * "did not come back from the dive". Naming the event being undone turns the
   * write into a compare-and-set: it applies only while the statement it is
   * about is still the one standing.
   *
   * Both halves of the assertion matter and they are opposite failures. Drop the
   * refusal and a stale phone erases somebody's missing-diver mark; over-tighten
   * it and the ordinary case — undo the tap I just made — stops working, which
   * is how a crew learns not to raise the alarm at all.
   */
  it("refuses an offline retraction another device has superseded, and applies one that still stands", async () => {
    vi.mocked(log).mockClear();
    const { db, shop, reef, booking, staff } = await manifestContext();
    const now = nowMs();
    const base = {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      checkpoint: "after_dive_1" as const,
      source: "offline" as const,
      offlineSnapshotSavedAt: new Date(now - 2 * 60 * 60 * 1000),
    };
    const mine = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

    // 09:50 — this device marks the diver not back aboard, and syncs it.
    await expect(
      recordRollCall(db, {
        ...base,
        status: "not_boarded",
        clientEventId: mine,
        occurredAt: new Date(now - 70 * 60 * 1000),
      }),
    ).resolves.toMatchObject({ ok: true });

    // 09:55 — a second device records its own "not back aboard" on the live
    // manifest. Nothing about that is visible to the first device.
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      checkpoint: "after_dive_1",
      status: "not_boarded",
      occurredAt: new Date(now - 65 * 60 * 1000),
    });

    // 10:00 — the first device retracts *its own* mark. Under the old rule this
    // applied (10:00 is not older than 09:55) and took the second device's alarm
    // off the boat with it.
    await expect(
      recordRollCall(db, {
        ...base,
        status: "cleared",
        clientEventId: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
        retractsClientEventId: mine,
        occurredAt: new Date(now - 60 * 60 * 1000),
      }),
    ).resolves.toEqual({ ok: false, reason: "retraction_superseded" });
    expect(log).toHaveBeenCalledWith("manifest.offline_retraction_superseded", "warn", {
      shopId: shop.id,
      tripId: reef.id,
    });
    // The alarm stands, which is the whole point of refusing.
    expect(
      (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.divers.find(
        (diver) => diver.bookingId === booking.booking.id,
      )?.rollCall,
    ).toMatchObject({ state: "not_boarded" });

    // And the ordinary case: retracting the statement that *is* still standing.
    const standing = "cccccccc-3333-4333-8333-cccccccccccc";
    await expect(
      recordRollCall(db, {
        ...base,
        status: "not_boarded",
        clientEventId: standing,
        occurredAt: new Date(now - 50 * 60 * 1000),
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      recordRollCall(db, {
        ...base,
        status: "cleared",
        clientEventId: "dddddddd-4444-4444-8444-dddddddddddd",
        retractsClientEventId: standing,
        occurredAt: new Date(now - 49 * 60 * 1000),
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(
      (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.divers.find(
        (diver) => diver.bookingId === booking.booking.id,
      )?.rollCall,
    ).toBeUndefined();
  });

  /**
   * The transition window, and the reason there isn't one.
   *
   * A retraction naming nothing is a retraction queued by a device that has not
   * had this deploy — a phone in a dry bag on a boat, which is the case the
   * whole feature exists for. Refusing it would discard a statement a crew
   * member actually made and mark it `rejected` on their screen, to enforce a
   * rule their build predates. So an absent `retractsClientEventId` keeps
   * exactly the behaviour it had before the field existed (newest-wins on
   * timestamp, scoped on the device to this device's own statement), and the
   * compare-and-set is a strict tightening of the events that do carry it.
   */
  it("still applies an offline retraction that names nothing, for a device queued before the field existed", async () => {
    vi.mocked(log).mockClear();
    const { db, shop, reef, booking, staff } = await manifestContext();
    const now = nowMs();
    const base = {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      checkpoint: "after_dive_1" as const,
      source: "offline" as const,
      offlineSnapshotSavedAt: new Date(now - 2 * 60 * 60 * 1000),
    };
    await expect(
      recordRollCall(db, {
        ...base,
        status: "not_boarded",
        clientEventId: "eeeeeeee-5555-4555-8555-eeeeeeeeeeee",
        occurredAt: new Date(now - 70 * 60 * 1000),
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      recordRollCall(db, {
        ...base,
        status: "cleared",
        clientEventId: "ffffffff-6666-4666-8666-ffffffffffff",
        occurredAt: new Date(now - 60 * 60 * 1000),
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(log).toHaveBeenCalledWith("manifest.offline_retraction_unnamed", "info", {
      shopId: shop.id,
      tripId: reef.id,
    });
  });

  it("raises the manifest-events push signal for a genuine write but not a duplicate replay", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.booking.id,
    });
    if (!issued.ok) throw new Error("expected waiver link");
    await completeWaiver(db, issued.token, {
      signerName: booking.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });

    let signalCount = 0;
    const unsubscribe = subscribeManifestEvents(shop.id, reef.id, () => {
      signalCount++;
    });
    try {
      const clientEventId = "33333333-3333-4333-8333-333333333333";
      const first = await recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        status: "boarded",
        source: "offline",
        clientEventId,
        offlineSnapshotSavedAt: nowDate(),
        occurredAt: nowDate(),
      });
      expect(first).toMatchObject({ ok: true });
      expect(signalCount).toBe(1);

      const duplicate = await recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        status: "boarded",
        source: "offline",
        clientEventId,
        offlineSnapshotSavedAt: nowDate(),
        occurredAt: nowDate(),
      });
      expect(duplicate).toMatchObject({ ok: true, duplicate: true });
      expect(signalCount).toBe(1);
    } finally {
      unsubscribe();
    }
  });

  it("rejects invalid checkpoints and implausible offline clocks", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        status: "not_boarded",
        checkpoint: "after_dive_3",
      }),
    ).resolves.toEqual({ ok: false, reason: "invalid_checkpoint" });

    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        status: "not_boarded",
        source: "offline",
        clientEventId: "33333333-3333-4333-8333-333333333333",
        offlineSnapshotSavedAt: new Date("2099-01-01T00:00:00.000Z"),
        occurredAt: new Date("2099-01-01T00:01:00.000Z"),
      }),
    ).resolves.toEqual({ ok: false, reason: "snapshot_invalid" });
  });

  /*
   * The read-back's final tiebreak is a property of the data, not of the
   * clock's resolution (ADR 20260815-roll-call-order-is-a-property-of-the-data).
   *
   * `occurred_at` ties routinely — the e2e clock is frozen, and an offline
   * batch is applied with whatever timestamps the device recorded — and
   * `created_at` is `defaultNow()`, which in Postgres is **transaction time**:
   * two rows written inside one transaction share it to the microsecond. Both
   * tied, the order was whatever the heap handed back, and the device/server
   * agreement this repo pinned would have stopped holding silently, with every
   * test green. `seq` is what makes "the later-appended row wins" true of the
   * rows themselves.
   */
  it("resolves a same-transaction, same-timestamp pair to the later-appended event", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    const occurredAt = new Date("2026-07-20T14:00:00.000Z");
    await db.transaction(async (tx) => {
      await tx.insert(rollCallEvents).values([
        {
          shopId: shop.id,
          tripId: reef.id,
          bookingId: booking.booking.id,
          recordedByPersonId: staff.id,
          status: "boarded",
          checkpoint: "departure",
          occurredAt,
        },
        {
          shopId: shop.id,
          tripId: reef.id,
          bookingId: booking.booking.id,
          recordedByPersonId: staff.id,
          status: "not_boarded",
          checkpoint: "departure",
          occurredAt,
        },
      ]);
    });
    const written = await db
      .select({
        status: rollCallEvents.status,
        createdAt: rollCallEvents.createdAt,
        seq: rollCallEvents.seq,
      })
      .from(rollCallEvents)
      .where(
        and(
          eq(rollCallEvents.tripId, reef.id),
          eq(rollCallEvents.bookingId, booking.booking.id),
          eq(rollCallEvents.checkpoint, "departure"),
        ),
      );
    expect(written).toHaveLength(2);
    // The tie is real: both halves of the old ordering key are equal here.
    const [one, two] = written;
    if (!one || !two) throw new Error("expected both events");
    expect(one.createdAt.getTime()).toBe(two.createdAt.getTime());
    expect(new Set(written.map((row) => row.seq)).size).toBe(2);
    const manifest = await getTripManifest(db, shop.id, reef.id, "departure");
    const diver = manifest?.divers.find((entry) => entry.bookingId === booking.booking.id);
    expect(diver?.rollCall?.state).toBe("not_boarded");
  });

  it("resolves a same-transaction crew pair the same way", async () => {
    const { db, shop, reef, staff } = await manifestContext();
    await db
      .insert(tripAssignments)
      .values({ tripId: reef.id, personId: staff.id })
      .onConflictDoNothing();
    const occurredAt = new Date("2026-07-20T14:00:00.000Z");
    await db.transaction(async (tx) => {
      await tx.insert(rollCallCrewEvents).values([
        {
          shopId: shop.id,
          tripId: reef.id,
          personId: staff.id,
          recordedByPersonId: staff.id,
          status: "not_boarded",
          checkpoint: "departure",
          occurredAt,
        },
        {
          shopId: shop.id,
          tripId: reef.id,
          personId: staff.id,
          recordedByPersonId: staff.id,
          status: "boarded",
          checkpoint: "departure",
          occurredAt,
        },
      ]);
    });
    const manifest = await getTripManifest(db, shop.id, reef.id, "departure");
    expect(manifest?.crew.find((member) => member.id === staff.id)?.rollCall?.state).toBe(
      "boarded",
    );
  });
});

/**
 * Security review of the live-roles work (commits 78ba3c4 / 98e3bd9). The
 * writer authorized its recorder with its own `person_roles` join and checked
 * neither `people.deleted_at` nor `user_accounts.status`, so a person the shop
 * had already removed still wrote real `roll_call_events` rows — head-count
 * entries in the record of who came back from a dive, attributed to somebody
 * who is not there.
 *
 * `/api/offline-manifests/sync` refuses both cases at the door, so this was
 * never exploitable through the shipped path. It is the defence-in-depth layer:
 * `recordRollCall` is a `src/db` writer, and the next call site — a route, a
 * cron, an import — would have inherited the hole. The refusal a caller sees is
 * the writer's existing `staff_not_found`, because it is the same answer to the
 * same question: whoever is claiming to record this is not this shop's staff.
 */
describe("the roll-call recorder must be live staff (defence in depth)", () => {
  /** Rows written against this booking, whatever the checkpoint or status. */
  async function eventsFor(
    db: Awaited<ReturnType<typeof manifestContext>>["db"],
    tripId: string,
    bookingId: string,
  ) {
    return db
      .select()
      .from(rollCallEvents)
      .where(and(eq(rollCallEvents.tripId, tripId), eq(rollCallEvents.bookingId, bookingId)));
  }

  it("refuses a deleted person, and writes no roll-call row for them", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    // Removed from the roster. `removeStaffMember` soft-deletes the person and
    // does not touch `person_roles`, so the role row they were authorized by is
    // still sitting there.
    await db.update(people).set({ deletedAt: nowDate() }).where(eq(people.id, staff.id));

    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        status: "not_boarded",
      }),
    ).resolves.toEqual({ ok: false, reason: "staff_not_found" });

    // The outcome that matters: a refusal that still wrote the row would be no
    // fix at all, because the row is the thing an incident report is read off.
    expect(await eventsFor(db, reef.id, booking.booking.id)).toEqual([]);
  });

  it("refuses a disabled account still holding a stale role row, and writes no roll-call row", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    // Access revoked, roster row intact — the ordinary "they left, keep the
    // history" shape. Sign-in already refuses this account; until now the
    // writer did not.
    await db
      .update(userAccounts)
      .set({ status: "disabled" })
      .where(eq(userAccounts.personId, staff.id));
    expect(
      await db.select().from(personRoles).where(eq(personRoles.personId, staff.id)),
    ).not.toEqual([]);

    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        status: "not_boarded",
      }),
    ).resolves.toEqual({ ok: false, reason: "staff_not_found" });

    expect(await eventsFor(db, reef.id, booking.booking.id)).toEqual([]);
  });

  it("still lets a live staff member record, and still refuses one demoted to diver", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    // The control for both refusals above: same shop, same booking, same call
    // — only the recorder's standing differs.
    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        status: "not_boarded",
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(await eventsFor(db, reef.id, booking.booking.id)).toMatchObject([
      { recordedByPersonId: staff.id, status: "not_boarded" },
    ]);

    // Demotion is the case the original hand-rolled join did catch, and the
    // rewrite must keep catching it: every staff role gone, a `diver` row left.
    await db
      .delete(personRoles)
      .where(and(eq(personRoles.personId, staff.id), inArray(personRoles.role, [...STAFF_ROLES])));
    await db.insert(personRoles).values({ personId: staff.id, role: "diver" });

    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        status: "boarded",
        checkpoint: "after_dive_1",
      }),
    ).resolves.toEqual({ ok: false, reason: "staff_not_found" });
    // Still just the one row the live staff member wrote.
    expect(await eventsFor(db, reef.id, booking.booking.id)).toHaveLength(1);
  });
});

describe("age on the crew's boarding list (H-21)", () => {
  it("carries age, minor status, and a birthday for divers with a date on file", async () => {
    const { db, shop, reef } = await manifestContext();
    const manifest = await getTripManifest(db, shop.id, reef.id, "departure");
    if (!manifest) throw new Error("expected a manifest");

    // The seed gives a handful of divers a date of birth, including one
    // 13-year-old with a birthday two days out (src/db/seed.ts).
    const withAge = manifest.divers.filter((diver) => diver.age !== null);
    expect(withAge.length).toBeGreaterThan(0);

    const minors = manifest.divers.filter((diver) => diver.minor);
    expect(minors.length).toBeGreaterThan(0);
    for (const minor of minors) {
      expect(minor.age).not.toBeNull();
      expect(minor.age as number).toBeLessThan(18);
    }

    const celebrating = manifest.divers.filter((diver) => diver.birthday);
    expect(celebrating.length).toBeGreaterThan(0);
    expect(celebrating[0].birthday).toMatchObject({ status: "soon" });
  });

  it("stays silent for divers the shop has never asked — no 'unknown age' down the boat", async () => {
    const { db, shop, reef } = await manifestContext();
    const manifest = await getTripManifest(db, shop.id, reef.id, "departure");
    if (!manifest) throw new Error("expected a manifest");

    const withoutDate = manifest.divers.filter((diver) => diver.age === null);
    expect(withoutDate.length).toBeGreaterThan(0);
    for (const diver of withoutDate) {
      expect(diver.minor).toBe(false);
      expect(diver.birthday).toBeNull();
    }
  });

  it("never lets age become a boarding gate", async () => {
    // A minor is a fact the crew is told, not a refusal. Nothing about being
    // under 18 may add a readiness blocker of its own.
    const { db, shop, reef } = await manifestContext();
    const manifest = await getTripManifest(db, shop.id, reef.id, "departure");
    if (!manifest) throw new Error("expected a manifest");
    for (const diver of manifest.divers.filter((entry) => entry.minor)) {
      expect(diver.readiness.blockers.map((blocker) => blocker.code)).not.toContain("minor");
    }
  });
});

describe("age and birthdays are measured on the day of the dive", () => {
  it("uses the trip date, not the day staff happen to open the page", async () => {
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    // A trip far enough out that "today" and "the day of the dive" cannot both
    // fall inside the birthday window — that gap is what makes this discriminating.
    const far = trips
      .filter((trip) => trip.startsAt.getTime() - nowMs() > 20 * 24 * 60 * 60 * 1000)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
    if (!far) throw new Error("seed should contain a trip more than 20 days out");
    const [booking] = await getTripRoster(db, shop.id, far.id);
    if (!booking) throw new Error("expected a booking on that trip");

    // Born so they turn 30 exactly on the day the boat sails.
    const sailing = calendarDateInTimezone(far.startsAt, shop.timezone);
    const dateOfBirth = `${Number(sailing.slice(0, 4)) - 30}${sailing.slice(4)}`;
    await db
      .update(people)
      .set({ dateOfBirth })
      .where(and(eq(people.shopId, shop.id), eq(people.id, booking.person.id)));

    const manifest = await getTripManifest(db, shop.id, far.id, "departure");
    const diver = manifest?.divers.find((entry) => entry.bookingId === booking.booking.id);
    if (!diver) throw new Error("diver missing from manifest");

    // Measured on the trip date: it is their birthday that day, and they are 30.
    expect(diver.birthday).toEqual({ status: "today" });
    expect(diver.age).toBe(30);
    // Measured from "now" it would be weeks away — outside the window entirely,
    // and they would still be 29. Both would be wrong on the boat.
    expect(
      birthdayCallout(dateOfBirth, calendarDateInTimezone(nowDate(), shop.timezone)),
    ).toBeNull();
    expect(ageOnDate(dateOfBirth, calendarDateInTimezone(nowDate(), shop.timezone))).toBe(29);
  });
});

/**
 * DOM-H1. Crew hold no booking, so `roll_call_events` — whose only subject
 * column is a `notNull` `bookingId` — has no id it could even record them
 * against. The interim slice is a per-checkpoint attested count that keeps the
 * checkpoint from reading complete. See ADR
 * 20260802-crew-roll-call-attestation.
 */
describe("crew emergency contacts (in-memory PGlite)", () => {
  // The glossary defines a manifest as every person on the boat *with* their
  // emergency contacts, and the printed sheet is what a coastguard reads.
  // Before this, `TripManifest["crew"]` carried no contact fields at all, so
  // the paper answered "who do we call?" for nine paying divers and for
  // neither of the two staff most reliably in the water (dive-domain review
  // 20260810). Crew are `people` rows, so nothing had to be stored — the
  // columns were already there and simply never read.
  it("carries each crew member's emergency contact off their person record", async () => {
    const { db, shop, reef, staff } = await manifestContext();
    await db
      .update(people)
      .set({
        emergencyContactName: "Marta Okonkwo (sister)",
        emergencyContactPhone: "+1-305-555-0114",
      })
      .where(eq(people.id, staff.id));
    await db
      .insert(tripAssignments)
      .values({ tripId: reef.id, personId: staff.id, tripRole: "captain" })
      .onConflictDoNothing();

    const manifest = await getTripManifest(db, shop.id, reef.id);
    const member = manifest?.crew.find((crew) => crew.id === staff.id);
    expect(member).toMatchObject({
      emergencyContactName: "Marta Okonkwo (sister)",
      emergencyContactPhone: "+1-305-555-0114",
    });
  });

  it("reads null for a crew member nobody has been asked about", async () => {
    // The ordinary state, and it must stay expressible: nobody is asked for a
    // crew contact at hire, and the row says "Not on file" in words rather
    // than printing a blank the reader has to interpret.
    const { db, shop, reef, staff } = await manifestContext();
    await db
      .update(people)
      .set({ emergencyContactName: null, emergencyContactPhone: null })
      .where(eq(people.id, staff.id));
    await db
      .insert(tripAssignments)
      .values({ tripId: reef.id, personId: staff.id, tripRole: "captain" })
      .onConflictDoNothing();

    const manifest = await getTripManifest(db, shop.id, reef.id);
    const member = manifest?.crew.find((crew) => crew.id === staff.id);
    expect(member).toMatchObject({
      emergencyContactName: null,
      emergencyContactPhone: null,
    });
  });

  it("keeps crew contacts out of the offline snapshot", async () => {
    // The dock copy is an explicit allow-list, and it stays that way: a crew
    // contact is personal data about a colleague retained on personal phones
    // for up to 14 days, and whether it belongs there is its own decision
    // (H-21's lesson — `age`, `minor` and `birthday` reached that payload by
    // riding along on a type). The live manifest gained two fields here; the
    // snapshot deliberately gained none.
    const { db, shop, reef, staff } = await manifestContext();
    await db
      .update(people)
      .set({ emergencyContactName: "Marta Okonkwo", emergencyContactPhone: "+1-305-555-0114" })
      .where(eq(people.id, staff.id));
    await db
      .insert(tripAssignments)
      .values({ tripId: reef.id, personId: staff.id, tripRole: "captain" })
      .onConflictDoNothing();

    const manifest = await getTripManifest(db, shop.id, reef.id);
    if (!manifest) throw new Error("manifest missing");
    const payload = serializeManifests(
      [manifest],
      {
        slug: shop.slug,
        name: shop.name,
        timezone: shop.timezone,
        emergencyReference: shop.emergencyReference,
      },
      (blocker) => blocker.code,
    );
    const crew = JSON.stringify(payload.manifests[0]?.crew);
    expect(crew).toContain(staff.fullName);
    expect(crew).not.toContain("Marta Okonkwo");
    expect(crew).not.toContain("555-0114");
  });
});

describe("crew aboard attestation (in-memory PGlite)", () => {
  // Since ADR 20260803-per-person-crew-roll-call the attested count is one of
  // two crew halves: every crew member the trip *names* also needs a result of
  // their own. Tests below that assert a checkpoint closes say both halves out
  // loud; the ones asserting it stays open are untouched.
  async function accountForEveryCrewMember(
    db: Awaited<ReturnType<typeof manifestContext>>["db"],
    shopId: string,
    tripId: string,
    staffId: string,
    checkpoint: RollCallCheckpoint,
  ) {
    const manifest = await getTripManifest(db, shopId, tripId, checkpoint);
    for (const member of manifest?.crew ?? []) {
      const outcome = await recordCrewRollCall(db, {
        shopId,
        tripId,
        personId: member.id,
        recordedByPersonId: staffId,
        status: "boarded",
        checkpoint,
      });
      if (!outcome.ok) throw new Error(`could not account for crew: ${outcome.reason}`);
    }
  }

  async function boardEveryDiver(
    db: Awaited<ReturnType<typeof manifestContext>>["db"],
    shopId: string,
    tripId: string,
    staffId: string,
    checkpoint: RollCallCheckpoint,
  ) {
    const roster = await getTripRoster(db, shopId, tripId);
    for (const entry of roster) {
      const outcome = await recordRollCall(db, {
        shopId,
        tripId,
        bookingId: entry.booking.id,
        recordedByPersonId: staffId,
        // An after-dive checkpoint is a head count, so readiness never refuses
        // here — which is exactly what makes "every diver counted" reachable
        // without also fixing the seed's waiver state.
        status: "boarded",
        checkpoint,
      });
      if (!outcome.ok) throw new Error(`could not board a diver: ${outcome.reason}`);
    }
  }

  it("does not read the checkpoint complete with every diver counted and the crew uncalled", async () => {
    const { db, shop, reef, staff } = await manifestContext();
    await boardEveryDiver(db, shop.id, reef.id, staff.id, "after_dive_1");

    const manifest = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
    // The precondition the old divers-only rule called "complete".
    expect(manifest?.summary.awaiting).toBe(0);
    expect(manifest?.summary.totalDivers).toBeGreaterThan(0);
    // The seed crews every charter, so there really are people unaccounted for.
    expect(manifest?.crew.length).toBeGreaterThan(0);
    expect(manifest?.completeness).toMatchObject({
      complete: false,
      diversAccountedFor: true,
      crewAccountedFor: false,
      reason: "crew_awaiting",
    });

    // Calling each of them by name is what closes it.
    await accountForEveryCrewMember(db, shop.id, reef.id, staff.id, "after_dive_1");
    expect(
      (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.completeness,
    ).toMatchObject({
      complete: true,
      diversAccountedFor: true,
      crewAccountedFor: true,
      reason: null,
    });
  });

  it("re-opens a closed checkpoint when another crew member is assigned afterwards", async () => {
    const { db, shop, reef, staff } = await manifestContext();
    await boardEveryDiver(db, shop.id, reef.id, staff.id, "after_dive_1");
    const assigned =
      (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.crew.length ?? 0;
    await accountForEveryCrewMember(db, shop.id, reef.id, staff.id, "after_dive_1");
    expect(
      (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.completeness.complete,
    ).toBe(true);

    // Completeness reads the assignment list *now*, so a person added after
    // the crew were called re-opens the checkpoint rather than riding on the
    // results already recorded against everybody else.
    const staffRows = await listStaff(db, shop.id);
    const assignedIds = new Set(
      (
        await db
          .select({ personId: tripAssignments.personId })
          .from(tripAssignments)
          .where(eq(tripAssignments.tripId, reef.id))
      ).map((row) => row.personId),
    );
    const extra = staffRows.find((row) => !assignedIds.has(row.person.id));
    if (!extra) throw new Error("seed should have a staff member not on this trip");
    await db.insert(tripAssignments).values({ tripId: reef.id, personId: extra.person.id });

    const reopened = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
    expect(reopened?.crew.length).toBe(assigned + 1);
    expect(reopened?.completeness).toMatchObject({ complete: false, reason: "crew_awaiting" });
  });

  /**
   * The one thing an empty crew list must never be is a free pass (ADR
   * 20260804-crew-roll-call-is-per-person). It is a scheduling gap, not
   * evidence that nobody else was aboard, and the manifest answers it with
   * "Add crew to trip" rather than a number to type.
   */
  it("holds the checkpoint open on a trip with nobody on the crew at all", async () => {
    const { db, shop, reef, staff } = await manifestContext();
    await boardEveryDiver(db, shop.id, reef.id, staff.id, "after_dive_1");
    await db.delete(tripAssignments).where(eq(tripAssignments.tripId, reef.id));

    const manifest = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
    expect(manifest?.crew).toEqual([]);
    expect(manifest?.completeness).toMatchObject({
      complete: false,
      diversAccountedFor: true,
      crewAccountedFor: false,
      reason: "crew_none_assigned",
      crewReason: "crew_none_assigned",
    });
  });

  /**
   * DOM-H1, the per-person rule (ADR 20260803-per-person-crew-roll-call, ADR
   * 20260804-crew-roll-call-is-per-person). Each assigned crew member is a
   * roll-call subject of their own — a `people.id`, never a booking, so
   * `roll_call_events.booking_id` stays `notNull` and the safety spine's
   * invariant is untouched.
   */
  describe("per-person crew roll call", () => {
    it("keeps the checkpoint open while a named crew member is unaccounted for", async () => {
      const { db, shop, reef, staff } = await manifestContext();
      await boardEveryDiver(db, shop.id, reef.id, staff.id, "after_dive_1");
      const crew = (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.crew ?? [];
      expect(crew.length).toBeGreaterThan(1);

      // Every diver is counted. The checkpoint stays open until each named
      // crew member has a result too.
      const [first, ...rest] = crew;
      if (!first) throw new Error("crew missing");
      expect(
        (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.completeness,
      ).toMatchObject({ complete: false, crewAccountedFor: false, reason: "crew_awaiting" });

      await expect(
        recordCrewRollCall(db, {
          shopId: shop.id,
          tripId: reef.id,
          personId: first.id,
          recordedByPersonId: staff.id,
          status: "boarded",
          checkpoint: "after_dive_1",
        }),
      ).resolves.toMatchObject({ ok: true });
      const partial = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
      expect(partial?.crew.find((member) => member.id === first.id)?.rollCall).toMatchObject({
        state: "boarded",
        recordedByName: staff.fullName,
      });
      expect(partial?.completeness).toMatchObject({ complete: false, reason: "crew_awaiting" });

      for (const member of rest) {
        await recordCrewRollCall(db, {
          shopId: shop.id,
          tripId: reef.id,
          personId: member.id,
          recordedByPersonId: staff.id,
          status: "boarded",
          checkpoint: "after_dive_1",
        });
      }
      expect(
        (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.completeness,
      ).toMatchObject({ complete: true, crewAccountedFor: true, reason: null });
    });

    it("re-opens the checkpoint when a crew member does not come back from a dive", async () => {
      const { db, shop, reef, staff } = await manifestContext();
      await boardEveryDiver(db, shop.id, reef.id, staff.id, "after_dive_1");
      await accountForEveryCrewMember(db, shop.id, reef.id, staff.id, "after_dive_1");
      const crew = (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.crew ?? [];
      expect(
        (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.completeness.complete,
      ).toBe(true);

      const missing = crew[0];
      if (!missing) throw new Error("crew missing");
      // A later event supersedes the earlier one without rewriting it — the
      // divemaster who surfaced then went back down for a lost weight belt.
      await expect(
        recordCrewRollCall(db, {
          shopId: shop.id,
          tripId: reef.id,
          personId: missing.id,
          recordedByPersonId: staff.id,
          status: "not_boarded",
          checkpoint: "after_dive_1",
          occurredAt: new Date(nowMs() + 60_000),
        }),
      ).resolves.toMatchObject({ ok: true });

      const reopened = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
      // Loudest reason on the boat: a human has said somebody in the water has
      // not come back.
      expect(reopened?.completeness).toMatchObject({
        complete: false,
        crewAccountedFor: false,
        reason: "crew_not_back_aboard",
      });
      // Both rows survive; nothing was edited in place.
      expect(
        await db
          .select()
          .from(rollCallCrewEvents)
          .where(eq(rollCallCrewEvents.personId, missing.id)),
      ).toHaveLength(2);
    });

    /**
     * The offline contract, mirrored from `recordRollCall` (H-46). These are
     * the three protections that make a device-recorded head count safe to
     * apply, and each one is tested here for crew because a crew-specific
     * reading of any of them is how a retried sync double-writes, or an
     * out-of-order one overwrites, the record of who came back from a dive.
     */
    it("applies a retried offline sync exactly once, however many times it arrives", async () => {
      const { db, shop, reef, staff } = await manifestContext();
      const crew = (await getTripManifest(db, shop.id, reef.id))?.crew ?? [];
      const member = crew[0];
      if (!member) throw new Error("crew missing");
      const now = nowMs();
      const offlineInput = {
        shopId: shop.id,
        tripId: reef.id,
        personId: member.id,
        recordedByPersonId: staff.id,
        status: "boarded" as const,
        checkpoint: "after_dive_1" as const,
        source: "offline" as const,
        clientEventId: "44444444-4444-4444-8444-444444444444",
        offlineSnapshotSavedAt: new Date(now - 2 * 60 * 60 * 1000),
        occurredAt: new Date(now - 60 * 60 * 1000),
      };

      const first = await recordCrewRollCall(db, offlineInput);
      const replay = await recordCrewRollCall(db, offlineInput);
      expect(first).toMatchObject({ ok: true });
      // Answered `ok`, so the device marks it settled and stops holding the
      // record alive — but nothing was written the second time.
      expect(replay).toMatchObject({ ok: true, duplicate: true });
      expect(
        (await db.select().from(rollCallCrewEvents)).filter(
          (event) => event.clientEventId === offlineInput.clientEventId,
        ),
      ).toHaveLength(1);
      // The row records where it came from, which is what makes an offline
      // result auditable afterwards rather than indistinguishable from a tap.
      const [written] = (await db.select().from(rollCallCrewEvents)).filter(
        (event) => event.clientEventId === offlineInput.clientEventId,
      );
      expect(written?.source).toBe("offline");

      // Newest wins: a live correction recorded since, then a *later-arriving*
      // but earlier-occurring offline event, which must not overwrite it.
      await recordCrewRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        personId: member.id,
        recordedByPersonId: staff.id,
        status: "not_boarded",
        checkpoint: "after_dive_1",
        occurredAt: new Date(now - 10 * 60 * 1000),
      });
      await expect(
        recordCrewRollCall(db, {
          ...offlineInput,
          clientEventId: "55555555-5555-4555-8555-555555555555",
          occurredAt: new Date(now - 30 * 60 * 1000),
        }),
      ).resolves.toEqual({ ok: false, reason: "newer_event_exists" });
      // And the live correction still stands — a divemaster the boat says did
      // not come back cannot be quietly re-boarded by a late sync.
      const reread = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
      expect(reread?.crew.find((entry) => entry.id === member.id)?.rollCall).toMatchObject({
        state: "not_boarded",
      });
    });

    /**
     * The crew half of the compare-and-set, asserted here rather than assumed
     * from the diver half (ADR 20260815-an-offline-retraction-names-its-target).
     * Both writers reach the same shared predicate, and the two halves of one
     * head count disagreeing about when a retraction applies is the class of bug
     * that survives whichever of the two somebody re-reads — crew are also the
     * people most reliably still in the water.
     */
    it("refuses an offline crew retraction another device has superseded, and applies one that still stands", async () => {
      vi.mocked(log).mockClear();
      const { db, shop, reef, staff } = await manifestContext();
      const crew = (await getTripManifest(db, shop.id, reef.id))?.crew ?? [];
      const member = crew[0];
      if (!member) throw new Error("crew missing");
      const now = nowMs();
      const base = {
        shopId: shop.id,
        tripId: reef.id,
        personId: member.id,
        recordedByPersonId: staff.id,
        checkpoint: "after_dive_1" as const,
        source: "offline" as const,
        offlineSnapshotSavedAt: new Date(now - 2 * 60 * 60 * 1000),
      };
      const mine = "a1a1a1a1-1111-4111-8111-a1a1a1a1a1a1";

      await expect(
        recordCrewRollCall(db, {
          ...base,
          status: "not_boarded",
          clientEventId: mine,
          occurredAt: new Date(now - 70 * 60 * 1000),
        }),
      ).resolves.toMatchObject({ ok: true });
      // A second device, on the live manifest, says the same thing again.
      await recordCrewRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        personId: member.id,
        recordedByPersonId: staff.id,
        checkpoint: "after_dive_1",
        status: "not_boarded",
        occurredAt: new Date(now - 65 * 60 * 1000),
      });
      await expect(
        recordCrewRollCall(db, {
          ...base,
          status: "cleared",
          clientEventId: "b2b2b2b2-2222-4222-8222-b2b2b2b2b2b2",
          retractsClientEventId: mine,
          occurredAt: new Date(now - 60 * 60 * 1000),
        }),
      ).resolves.toEqual({ ok: false, reason: "retraction_superseded" });
      expect(log).toHaveBeenCalledWith("manifest.offline_retraction_superseded", "warn", {
        shopId: shop.id,
        tripId: reef.id,
      });
      expect(
        (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.crew.find(
          (entry) => entry.id === member.id,
        )?.rollCall,
      ).toMatchObject({ state: "not_boarded" });

      // The tap this control exists for: undoing the statement still standing.
      const standing = "c3c3c3c3-3333-4333-8333-c3c3c3c3c3c3";
      await expect(
        recordCrewRollCall(db, {
          ...base,
          status: "not_boarded",
          clientEventId: standing,
          occurredAt: new Date(now - 50 * 60 * 1000),
        }),
      ).resolves.toMatchObject({ ok: true });
      await expect(
        recordCrewRollCall(db, {
          ...base,
          status: "cleared",
          clientEventId: "d4d4d4d4-4444-4444-8444-d4d4d4d4d4d4",
          retractsClientEventId: standing,
          occurredAt: new Date(now - 49 * 60 * 1000),
        }),
      ).resolves.toMatchObject({ ok: true });
      expect(
        (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.crew.find(
          (entry) => entry.id === member.id,
        )?.rollCall,
      ).toBeUndefined();
    });

    it("refuses an offline crew event whose snapshot bounds do not hold", async () => {
      const { db, shop, reef, staff } = await manifestContext();
      const crew = (await getTripManifest(db, shop.id, reef.id))?.crew ?? [];
      const member = crew[0];
      if (!member) throw new Error("crew missing");
      const base = {
        shopId: shop.id,
        tripId: reef.id,
        personId: member.id,
        recordedByPersonId: staff.id,
        status: "boarded" as const,
        source: "offline" as const,
      };

      // A snapshot claiming to postdate the result recorded from it, and a
      // result recorded in the future — the same two clauses the diver path
      // applies, through the same shared predicate.
      await expect(
        recordCrewRollCall(db, {
          ...base,
          clientEventId: "66666666-6666-4666-8666-666666666666",
          offlineSnapshotSavedAt: new Date("2099-01-01T00:00:00.000Z"),
          occurredAt: new Date("2099-01-01T00:01:00.000Z"),
        }),
      ).resolves.toEqual({ ok: false, reason: "snapshot_invalid" });

      // No idempotency key means the write is not replay-safe, so it is not
      // accepted at all rather than accepted once and duplicated on retry.
      await expect(
        recordCrewRollCall(db, {
          ...base,
          clientEventId: undefined,
          offlineSnapshotSavedAt: nowDate(),
          occurredAt: nowDate(),
        }),
      ).resolves.toEqual({ ok: false, reason: "snapshot_invalid" });

      // Nothing was written by either, so the checkpoint stays open — the
      // fail-closed direction.
      expect(await db.select().from(rollCallCrewEvents)).toHaveLength(0);
    });

    it("undoes a mis-tap with a cleared event, returning the crew member to awaiting", async () => {
      const { db, shop, reef, staff } = await manifestContext();
      const crew = (await getTripManifest(db, shop.id, reef.id))?.crew ?? [];
      const member = crew[0];
      if (!member) throw new Error("crew missing");
      await recordCrewRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        personId: member.id,
        recordedByPersonId: staff.id,
        status: "boarded",
      });
      await recordCrewRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        personId: member.id,
        recordedByPersonId: staff.id,
        status: "cleared",
        occurredAt: new Date(nowMs() + 60_000),
      });
      const manifest = await getTripManifest(db, shop.id, reef.id);
      expect(manifest?.crew.find((entry) => entry.id === member.id)?.rollCall).toBeUndefined();
    });

    it("carries a dock-side absence forward, and never carries an after-dive one", async () => {
      const { db, shop, reef, staff } = await manifestContext();
      const crew = (await getTripManifest(db, shop.id, reef.id))?.crew ?? [];
      const ashore = crew[0];
      if (!ashore) throw new Error("crew missing");
      // Called in sick: never left the dock, which is true of every later
      // checkpoint too — the same rule a diver's result follows (DOM-H3).
      await recordCrewRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        personId: ashore.id,
        recordedByPersonId: staff.id,
        status: "not_boarded",
        checkpoint: "departure",
      });
      const manifests = await getTripManifests(db, shop.id, reef.id);
      const afterDive = manifests?.find((entry) => entry.checkpoint === "after_dive_1");
      const carried = afterDive?.crew.find((entry) => entry.id === ashore.id)?.rollCall;
      expect(carried).toMatchObject({ state: "not_boarded", implied: true });
      // Carried forward is *accounted for* — they are ashore, not in the water.
      expect(afterDive?.completeness.reason).not.toBe("crew_not_back_aboard");
    });

    it("refuses a subject who is not this trip's crew, another shop's trip, or a bad checkpoint", async () => {
      const { db, shop, reef, staff, booking } = await manifestContext();
      const [otherShop] = await db
        .insert(shops)
        .values({ name: "Other Shop", slug: "other-shop-crew-roll-call", timezone: "UTC" })
        .returning();
      if (!otherShop) throw new Error("second shop insert failed");
      const crew = (await getTripManifest(db, shop.id, reef.id))?.crew ?? [];
      const subject = crew[0];
      if (!subject) throw new Error("crew missing");

      // Tenant scoping, both ways round: another shop's id against this trip,
      // and this shop against a subject who was never rostered here.
      await expect(
        recordCrewRollCall(db, {
          shopId: otherShop.id,
          tripId: reef.id,
          personId: subject.id,
          recordedByPersonId: staff.id,
          status: "boarded",
        }),
      ).resolves.toEqual({ ok: false, reason: "staff_not_found" });

      // A booked diver is not crew — being a person in this shop is not enough
      // to be a subject, because the rule is about the crew this trip *has*.
      await expect(
        recordCrewRollCall(db, {
          shopId: shop.id,
          tripId: reef.id,
          personId: booking.person.id,
          recordedByPersonId: staff.id,
          status: "boarded",
        }),
      ).resolves.toEqual({ ok: false, reason: "crew_not_assigned" });

      // ...and a diver cannot record one either.
      await expect(
        recordCrewRollCall(db, {
          shopId: shop.id,
          tripId: reef.id,
          personId: subject.id,
          recordedByPersonId: booking.person.id,
          status: "boarded",
        }),
      ).resolves.toEqual({ ok: false, reason: "staff_not_found" });

      await expect(
        recordCrewRollCall(db, {
          shopId: shop.id,
          tripId: reef.id,
          personId: subject.id,
          recordedByPersonId: staff.id,
          status: "boarded",
          checkpoint: "after_dive_9",
        }),
      ).resolves.toEqual({ ok: false, reason: "invalid_checkpoint" });

      // Nothing was written by any of the refusals above.
      expect(
        await db.select().from(rollCallCrewEvents).where(eq(rollCallCrewEvents.tripId, reef.id)),
      ).toEqual([]);
    });

    /**
     * Review 20260803, D11. The subject check proved only "assigned to this
     * trip", while `listTripCrew` reads the crew list through a `person_roles`
     * join filtered to `STAFF_ROLES`. A person who was assigned but held no
     * staff role could therefore carry roll-call events and appear in neither
     * the crew list nor the denominator — a result about somebody the head
     * count could not see. One definition of "on this trip's crew", or the two
     * halves answer differently.
     */
    it("refuses a subject who is assigned but holds no staff role, as the crew list does", async () => {
      const { db, shop, reef, staff, booking } = await manifestContext();
      // A booked diver, rostered onto the trip by a direct insert: assigned,
      // but not staff.
      await db.insert(tripAssignments).values({ tripId: reef.id, personId: booking.person.id });
      expect(
        (await getTripManifest(db, shop.id, reef.id))?.crew.some(
          (member) => member.id === booking.person.id,
        ),
      ).toBe(false);
      await expect(
        recordCrewRollCall(db, {
          shopId: shop.id,
          tripId: reef.id,
          personId: booking.person.id,
          recordedByPersonId: staff.id,
          status: "boarded",
        }),
      ).resolves.toEqual({ ok: false, reason: "crew_not_assigned" });
      expect(
        await db.select().from(rollCallCrewEvents).where(eq(rollCallCrewEvents.tripId, reef.id)),
      ).toEqual([]);
    });

    /**
     * Dive-domain review 20260804. `removeStaffMember`, `setStaffRoles`, and
     * erasure all delete a person's `person_roles` rows and none of them
     * touches `trip_assignments`. The crew list read through a
     * `STAFF_ROLES`-filtered join, so somebody leaving the team dropped off
     * *every* trip they had ever crewed — including one where a human had
     * recorded that they **did not come back**. The checkpoint that was open
     * for exactly that reason then read complete, with the event rows still
     * sitting there unread.
     *
     * This is the same class as D3 (which `changeTripCrew` closed for the
     * trip-level unassign) reached through the team-management door instead.
     */
    it("keeps a former staff member on the crew list, so their result still holds the checkpoint open", async () => {
      const { db, shop, reef, staff } = await manifestContext();
      await boardEveryDiver(db, shop.id, reef.id, staff.id, "after_dive_1");
      await accountForEveryCrewMember(db, shop.id, reef.id, staff.id, "after_dive_1");
      const crew = (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.crew ?? [];
      const leaver = crew.find((member) => member.id !== staff.id) ?? crew[0];
      if (!leaver) throw new Error("crew missing");

      // A divemaster who did not surface: the loudest state the manifest has.
      await expect(
        recordCrewRollCall(db, {
          shopId: shop.id,
          tripId: reef.id,
          personId: leaver.id,
          recordedByPersonId: staff.id,
          status: "not_boarded",
          checkpoint: "after_dive_1",
          occurredAt: new Date(nowMs() + 60_000),
        }),
      ).resolves.toMatchObject({ ok: true });
      expect(
        (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.completeness,
      ).toMatchObject({ complete: false, reason: "crew_not_back_aboard" });

      // They leave the shop. Every staff role goes; the assignment does not.
      await db
        .delete(personRoles)
        .where(
          and(eq(personRoles.personId, leaver.id), inArray(personRoles.role, [...STAFF_ROLES])),
        );

      const after = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
      // Still named on the boat they sailed on...
      expect(after?.crew.map((member) => member.id)).toContain(leaver.id);
      // ...and the checkpoint they are holding open is still open.
      expect(after?.completeness).toMatchObject({
        complete: false,
        crewAccountedFor: false,
        reason: "crew_not_back_aboard",
      });

      // And they can still be recorded, so the checkpoint can be closed by
      // saying what happened rather than only by deleting the person.
      await expect(
        recordCrewRollCall(db, {
          shopId: shop.id,
          tripId: reef.id,
          personId: leaver.id,
          recordedByPersonId: staff.id,
          status: "boarded",
          checkpoint: "after_dive_1",
          occurredAt: new Date(nowMs() + 120_000),
        }),
      ).resolves.toMatchObject({ ok: true });
      expect(
        (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.completeness,
      ).toMatchObject({ complete: true, reason: null });
    });

    it("still refuses a former staff member who never had a result on the trip", async () => {
      // The D11 rule is unchanged in the direction that matters: history is
      // what keeps somebody visible, not merely having once been staff. A
      // rostered non-staff person with no events stays off the list and off
      // the denominator, so no checkpoint is held open by a ghost.
      const { db, shop, reef, staff, booking } = await manifestContext();
      await db.insert(tripAssignments).values({ tripId: reef.id, personId: booking.person.id });

      const manifest = await getTripManifest(db, shop.id, reef.id);
      expect(manifest?.crew.some((member) => member.id === booking.person.id)).toBe(false);
      await expect(
        recordCrewRollCall(db, {
          shopId: shop.id,
          tripId: reef.id,
          personId: booking.person.id,
          recordedByPersonId: staff.id,
          status: "boarded",
        }),
      ).resolves.toEqual({ ok: false, reason: "crew_not_assigned" });
    });

    it("carries each crew member's result into the offline snapshot, with their id", async () => {
      const { db, shop, reef, staff } = await manifestContext();
      const crew = (await getTripManifest(db, shop.id, reef.id))?.crew ?? [];
      const member = crew[0];
      if (!member) throw new Error("crew missing");
      await recordCrewRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        personId: member.id,
        recordedByPersonId: staff.id,
        status: "boarded",
      });
      const manifests = await getTripManifests(db, shop.id, reef.id);
      if (!manifests) throw new Error("manifests missing");
      const payload = serializeManifests(
        manifests,
        {
          slug: shop.slug,
          name: shop.name,
          timezone: shop.timezone,
          emergencyReference: shop.emergencyReference,
        },
        (blocker) => blocker.code,
      );
      const departure = payload.manifests.find((entry) => entry.checkpoint === "departure");
      const saved = departure?.crew.find((entry) => entry.fullName === member.fullName);
      expect(saved?.rollCall).toMatchObject({ state: "boarded", recordedByName: staff.fullName });
      // ISO string, not a Date — the snapshot is JSON before it is encrypted.
      expect(typeof saved?.rollCall?.occurredAt).toBe("string");
      // The id rides along (H-46): it is the subject of a crew roll-call
      // write, and without it the crew half of the head count cannot be
      // recorded on a phone with no signal — which meant an after-dive
      // checkpoint could not be closed at sea at all.
      expect(saved?.id).toBe(member.id);
      expect(departure?.crew.every((entry) => typeof entry.id === "string")).toBe(true);
      // And the crew member nobody counted reads as awaiting there, which is
      // what makes the offline copy fail closed.
      const uncounted = departure?.crew.find((entry) => entry.fullName !== member.fullName);
      expect(uncounted?.rollCall).toBeUndefined();
    });
  });

  it("carries the crew results into the offline snapshot, and the offline copy agrees with the live one", async () => {
    const { db, shop, reef, staff } = await manifestContext();
    await boardEveryDiver(db, shop.id, reef.id, staff.id, "after_dive_1");
    const beforeCalling = await getTripManifests(db, shop.id, reef.id);
    if (!beforeCalling) throw new Error("manifests missing");
    const uncalledPayload = serializeManifests(
      beforeCalling,
      {
        slug: shop.slug,
        name: shop.name,
        timezone: shop.timezone,
        emergencyReference: shop.emergencyReference,
      },
      (blocker) => blocker.code,
    );
    const uncalledAfterDive = uncalledPayload.manifests.find(
      (entry) => entry.checkpoint === "after_dive_1",
    );
    // Nobody called: the dock copy recomputes the same open checkpoint the
    // live page shows, rather than reading "complete" with the crew unaccounted for.
    expect(uncalledAfterDive?.crew.every((member) => member.rollCall === undefined)).toBe(true);
    expect(
      rollCallCompleteness({
        checkpoint: "after_dive_1",
        totalDivers: uncalledAfterDive?.summary.totalDivers ?? 0,
        awaiting: 0,
        notBackAboard: 0,
        // The dock copy derives the crew half from the snapshot's own crew
        // list, exactly as OfflineManifestView does — which is what makes an
        // older snapshot with no crew results read every crew member as
        // awaiting rather than as accounted for.
        crew: uncalledAfterDive?.crew ?? [],
      }),
    ).toMatchObject({ complete: false, reason: "crew_awaiting" });

    await accountForEveryCrewMember(db, shop.id, reef.id, staff.id, "after_dive_1");

    const manifests = await getTripManifests(db, shop.id, reef.id);
    if (!manifests) throw new Error("manifests missing");
    const payload = serializeManifests(
      manifests,
      {
        slug: shop.slug,
        name: shop.name,
        timezone: shop.timezone,
        emergencyReference: shop.emergencyReference,
      },
      (blocker) => blocker.code,
    );
    const afterDive = payload.manifests.find((entry) => entry.checkpoint === "after_dive_1");
    expect(afterDive?.crew.every((member) => member.rollCall?.state === "boarded")).toBe(true);
    // ISO string, not a Date: the snapshot is JSON before it is encrypted.
    expect(typeof afterDive?.crew[0]?.rollCall?.occurredAt).toBe("string");
    // Crew person ids now ride along (H-46): they are the subject of a crew
    // roll-call write, and carrying them is what makes the crew half of the
    // head count recordable with the radio off. Deliberately added to the
    // payload's allow-list, which is the allow-list working rather than being
    // abandoned — a diver's age, minor status and birthday are still absent,
    // asserted directly in offline-manifests.test.ts.
    expect(afterDive?.crew.every((member) => typeof member.id === "string")).toBe(true);
    // Same function the offline view calls, same answer as the live page.
    expect(
      rollCallCompleteness({
        checkpoint: "after_dive_1",
        totalDivers: afterDive?.summary.totalDivers ?? 0,
        awaiting: 0,
        notBackAboard: 0,
        crew: afterDive?.crew ?? [],
      }).complete,
    ).toBe(
      manifests.find((entry) => entry.checkpoint === "after_dive_1")?.completeness.complete ??
        false,
    );
  });
});

/**
 * ADR 20260828-a-missing-diver-gets-a-sentence. The note was deleted outright
 * in 2026-08 and came back narrowed, because a roll call that records *that* a
 * diver did not come back and never *what happened to them* leaves an
 * unexplained red mark on the document an investigator reads.
 *
 * What is pinned here is the narrowing, since that is the whole of the
 * decision: the sentence exists at an after-dive checkpoint and nowhere else,
 * and the writer enforces it rather than trusting the surface that posted it.
 */
describe("a roll-call note is kept where a person can be unaccounted for", () => {
  it("writes what the crew observed on an after-dive result", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      status: "not_boarded",
      checkpoint: "after_dive_1",
      note: "  Surfaced 200 m north, picked up by Reef Runner at 14:31.  ",
    });
    const manifest = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
    const diver = manifest?.divers.find((entry) => entry.bookingId === booking.booking.id);
    // Trimmed, and reaching the surface through the ordinary manifest read —
    // the same path the row, the offline copy and the departure log take.
    expect(diver?.rollCall?.note).toBe("Surfaced 200 m north, picked up by Reef Runner at 14:31.");
  });

  it("drops a note posted against a departure result", async () => {
    // At the dock `not_boarded` means "never left", which is clerical and has
    // never needed a sentence — so no surface offers a box there, and a
    // hand-crafted post does not get to put free text on the append-only
    // safety trail either.
    const { db, shop, reef, booking, staff } = await manifestContext();
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      status: "not_boarded",
      checkpoint: "departure",
      note: "should not be written",
    });
    const manifest = await getTripManifest(db, shop.id, reef.id, "departure");
    const diver = manifest?.divers.find((entry) => entry.bookingId === booking.booking.id);
    expect(diver?.rollCall?.state).toBe("not_boarded");
    expect(diver?.rollCall?.note).toBeNull();
  });

  it("drops a note on an ordinary boarded tap, where nobody is unaccounted for", async () => {
    // The hole the first cut of this left: enforcing only the checkpoint let a
    // note ride the common after-dive "everybody came back" tap onto the
    // append-only trail from any surface that offered a box.
    const { db, shop, reef, booking, staff } = await manifestContext();
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      status: "boarded",
      checkpoint: "after_dive_1",
      note: "should not be written",
    });
    const manifest = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
    const diver = manifest?.divers.find((entry) => entry.bookingId === booking.booking.id);
    expect(diver?.rollCall?.state).toBe("boarded");
    expect(diver?.rollCall?.note).toBeNull();
  });

  it("keeps the sighting that takes a stated alarm back", async () => {
    // The other half of the same rule, and the reason it reads the row rather
    // than the payload: this `boarded` is the retraction of a standing "did
    // not come back", which is the observation most worth recording.
    const { db, shop, reef, booking, staff } = await manifestContext();
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      status: "not_boarded",
      checkpoint: "after_dive_1",
    });
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      status: "boarded",
      checkpoint: "after_dive_1",
      note: "Eyes on her at the ladder, came up 200 m north.",
    });
    const manifest = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
    const diver = manifest?.divers.find((entry) => entry.bookingId === booking.booking.id);
    expect(diver?.rollCall?.state).toBe("boarded");
    expect(diver?.rollCall?.note).toBe("Eyes on her at the ladder, came up 200 m north.");
  });

  it("leaves an ordinary result with nothing to say", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      status: "boarded",
      checkpoint: "after_dive_1",
    });
    const manifest = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
    const diver = manifest?.divers.find((entry) => entry.bookingId === booking.booking.id);
    expect(diver?.rollCall?.state).toBe("boarded");
    expect(diver?.rollCall?.note).toBeNull();
  });
});

/**
 * DOM-H3. The manifest and the Today work queue read the same roll-call rows
 * and used to reach opposite conclusions from them: Today raised a
 * top-severity `roll_call_missing_diver` row while the manifest printed "Roll
 * call complete ✦" for the same boat, because `carryForwardNotBoarded` treated
 * an after-dive `not_boarded` as an accounted-for record.
 *
 * Two safety surfaces disagreeing about whether everyone is out of the water is
 * worse than either being wrong alone, so this asserts the agreement directly
 * rather than each side's rule in isolation.
 */
describe("the manifest and Today agree about who is still in the water (DOM-H3)", () => {
  async function afterDiveContext() {
    const context = await manifestContext();
    const { db, shop, reef, staff } = context;
    const roster = await getTripRoster(db, shop.id, reef.id);
    expect(roster.length).toBeGreaterThan(1);
    // Board everyone after dive one — a head count, so readiness never refuses
    // — and leave exactly one diver marked as not back aboard.
    for (const entry of roster) {
      const outcome = await recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: entry.booking.id,
        recordedByPersonId: staff.id,
        status: "boarded",
        checkpoint: "after_dive_1",
      });
      if (!outcome.ok) throw new Error(`could not board a diver: ${outcome.reason}`);
    }
    // The crew half is satisfied first, so the *only* thing that can hold this
    // checkpoint open below is the diver who has not come back.
    for (const member of (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.crew ??
      []) {
      const crewOutcome = await recordCrewRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        personId: member.id,
        recordedByPersonId: staff.id,
        status: "boarded",
        checkpoint: "after_dive_1",
      });
      if (!crewOutcome.ok) throw new Error(`could not account for crew: ${crewOutcome.reason}`);
    }
    // Just after the boat ties up: home, and well inside the dock-work window.
    const now = new Date(reef.endsAt.getTime() + 60_000);
    return { ...context, missing: roster[0], now };
  }

  it("holds the checkpoint open and raises the missing-diver row for the same trip", async () => {
    const { db, shop, reef, staff, missing, now } = await afterDiveContext();
    if (!missing) throw new Error("roster missing");

    // Everything closed before anyone says otherwise.
    const closed = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
    expect(closed?.completeness).toMatchObject({ complete: true, reason: null });
    expect(
      (await listRollCallGaps(db, shop.id, now)).some(
        (gap) => gap.tripId === reef.id && gap.reason === "missing_diver",
      ),
    ).toBe(false);

    // One diver did not come back from dive one.
    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: missing.booking.id,
        recordedByPersonId: staff.id,
        status: "not_boarded",
        checkpoint: "after_dive_1",
      }),
    ).resolves.toMatchObject({ ok: true });

    const manifest = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
    // Every diver has a result, so the old `awaiting === 0` rule called this
    // complete — which is exactly the screen that contradicted Today.
    expect(manifest?.summary.awaiting).toBe(0);
    expect(manifest?.summary.notBackAboard).toBe(1);
    expect(manifest?.summary.unaccountedFor).toBe(1);
    expect(manifest?.completeness).toMatchObject({
      complete: false,
      diversAccountedFor: false,
      crewAccountedFor: true,
      reason: "divers_not_back_aboard",
    });

    const gap = (await listRollCallGaps(db, shop.id, now)).find(
      (entry) => entry.tripId === reef.id && entry.reason === "missing_diver",
    );
    expect(gap).toBeDefined();
    expect(gap?.diveNumber).toBe(1);
    expect(gap?.uncounted).toBe(1);
    // The agreement itself, stated as one assertion: the manifest cannot read
    // closed while Today is alarming about the same boat.
    expect(manifest?.completeness.complete).toBe(gap === undefined);
  });

  it("does not let the missing diver's result close dive two either", async () => {
    const { db, shop, reef, staff, missing, now } = await afterDiveContext();
    if (!missing) throw new Error("roster missing");
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: missing.booking.id,
      recordedByPersonId: staff.id,
      status: "not_boarded",
      checkpoint: "after_dive_1",
    });

    // Nothing carries forward from an after-dive result: dive two has to ask
    // again rather than inheriting "not boarded" as a settled answer.
    const diveTwo = await getTripManifest(db, shop.id, reef.id, "after_dive_2");
    const diverAtDiveTwo = diveTwo?.divers.find((entry) => entry.bookingId === missing.booking.id);
    expect(diverAtDiveTwo?.rollCall).toBeUndefined();
    expect(diveTwo?.completeness).toMatchObject({ reason: "divers_awaiting" });
    expect(diveTwo?.completeness.complete).toBe(false);
    // And Today still has the boat.
    expect((await listRollCallGaps(db, shop.id, now)).some((gap) => gap.tripId === reef.id)).toBe(
      true,
    );
  });

  it("still carries a departure not-boarded forward as a diver who is accounted for", async () => {
    const { db, shop, reef, staff } = await manifestContext();
    const roster = await getTripRoster(db, shop.id, reef.id);
    const ashore = roster[0];
    if (!ashore) throw new Error("roster missing");
    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: ashore.booking.id,
        recordedByPersonId: staff.id,
        status: "not_boarded",
        checkpoint: "departure",
      }),
    ).resolves.toMatchObject({ ok: true });

    // "Never left the dock" is benign and correctly true of every later
    // checkpoint — this half of carry-forward is unchanged.
    for (const checkpoint of ["after_dive_1", "after_dive_2"] as const) {
      const manifest = await getTripManifest(db, shop.id, reef.id, checkpoint);
      const diver = manifest?.divers.find((entry) => entry.bookingId === ashore.booking.id);
      expect(diver?.rollCall).toMatchObject({ state: "not_boarded", implied: true });
      // Carried, so not a missing diver and not an awaiting one either.
      expect(manifest?.summary.notBackAboard).toBe(0);
      expect(isRollCallAccountedFor(checkpoint, diver?.rollCall)).toBe(true);
    }
  });
});
