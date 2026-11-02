import { describe, expect, it } from "vitest";
import type { ReadinessBlocker } from "./readiness";
import {
  ACTION_KIND_META,
  assembleDaySpine,
  collapseEmailDeliveries,
  collapseOwedRefunds,
  crewClashPhase,
  diverBlockerAction,
  factOfScaleFor,
  filterActionsForRoles,
  groupByDeparture,
  KIND_AUDIENCE,
  type OwedRefundInput,
  primaryBlocker,
  readNeedsYou,
  roleLensFor,
  rollCallGapUrgency,
  type SpineDeparture,
  sortStationRows,
  spineIsQuiet,
  spineJobCount,
  type TodayAction,
  todaysBoatsAreClear,
  urgencyFor,
} from "./today";

const NOW = new Date("2026-07-20T14:00:00Z");
const hoursFromNow = (hours: number) => new Date(NOW.getTime() + hours * 60 * 60 * 1000);

function blocker(code: ReadinessBlocker["code"]): ReadinessBlocker {
  return { code };
}

function action(overrides: Partial<TodayAction> = {}): TodayAction {
  return {
    id: "a",
    kind: "waiver",
    urgency: "now",
    subject: "Diver",
    context: null,
    detail: "…",
    actionLabel: "Do it",
    href: "/",
    dueAt: hoursFromNow(2),
    ...overrides,
  };
}

describe("urgencyFor", () => {
  it("flags the next boat out — inside three hours — as imminent", () => {
    expect(urgencyFor(hoursFromNow(0.5), NOW)).toBe("imminent");
    expect(urgencyFor(hoursFromNow(3), NOW)).toBe("imminent");
  });

  it("treats the rest of today, past the imminent window, as work for now", () => {
    expect(urgencyFor(hoursFromNow(3.5), NOW)).toBe("now");
    expect(urgencyFor(hoursFromNow(23), NOW)).toBe("now");
  });

  it("separates the next three days from the rest of the week", () => {
    expect(urgencyFor(hoursFromNow(30), NOW)).toBe("soon");
    expect(urgencyFor(hoursFromNow(71), NOW)).toBe("soon");
    expect(urgencyFor(hoursFromNow(80), NOW)).toBe("later");
  });

  it("puts undated work last rather than pretending it is urgent", () => {
    expect(urgencyFor(null, NOW)).toBe("later");
  });
});

describe("primaryBlocker", () => {
  it("returns null when a diver is clear", () => {
    expect(primaryBlocker([])).toBeNull();
  });

  it("ranks evidence that has to come from a physician above dock-side work", () => {
    const chosen = primaryBlocker([blocker("payment_due"), blocker("medical_review")]);
    expect(chosen?.code).toBe("medical_review");
  });

  it("ranks a missing card above an unsent waiver", () => {
    const chosen = primaryBlocker([blocker("waiver_not_sent"), blocker("certification_missing")]);
    expect(chosen?.code).toBe("certification_missing");
  });

  it("keeps the first blocker when severity ties", () => {
    const chosen = primaryBlocker([blocker("waiver_pending"), blocker("waiver_expired")]);
    expect(chosen?.code).toBe("waiver_pending");
  });
});

describe("diverBlockerAction", () => {
  const input = {
    bookingId: "b1",
    personId: "p1",
    fullName: "Maya Alvarez",
    tripId: "t1",
    tripTitle: "Reef Drift · 8:00 AM",
    startsAt: hoursFromNow(3),
    blockers: [blocker("waiver_not_sent")],
  };

  it("sends waiver work in place, keeping the verb and the booking payload", () => {
    const result = diverBlockerAction(input, "blue-reef", NOW);
    // href stays the row's real destination, the roster row.
    expect(result?.href).toBe("/shop/blue-reef/trips/t1#booking-b1");
    expect(result?.actionLabel).toBe("Send waiver");
    expect(result?.waiver).toEqual({ bookingIds: ["b1"] });
    expect(result?.subject).toBe("Maya Alvarez");
    expect(result?.urgency).toBe("imminent");
  });

  it("points card work at the person record instead of pretending to act", () => {
    const result = diverBlockerAction(
      { ...input, blockers: [blocker("certification_pending")] },
      "blue-reef",
      NOW,
    );
    expect(result?.href).toBe("/shop/blue-reef/divers/p1");
    // The tap only opens the record, so the label points rather than commands.
    expect(result?.actionLabel).toBe("Open Maya’s record");
    expect(result?.waiver).toBeUndefined();
  });

  /**
   * H-20261008-cert-check-extension: a card still waiting for its check names its diver, so the shop
   * home can offer "Check with SSI" from the row. The cards themselves are the
   * read's to find (`withAgencyChecks`), and the row keeps its door.
   */
  it("names the diver on a pending card's row, and on no other kind", () => {
    const pending = diverBlockerAction(
      { ...input, blockers: [blocker("certification_pending")] },
      "blue-reef",
      NOW,
    );
    expect(pending?.agencyCheck).toEqual({ personId: "p1", cards: [] });
    expect(pending?.href).toBe("/shop/blue-reef/divers/p1");

    for (const code of ["certification_missing", "nitrox_pending", "waiver_not_sent"] as const) {
      const other = diverBlockerAction({ ...input, blockers: [blocker(code)] }, "blue-reef", NOW);
      expect(other?.agencyCheck).toBeUndefined();
    }
  });

  /**
   * A held seat (H-20260724-one-person-per-email): the human on this booking may not be the one whose
   * cards are on file, so no row offers to check that person's card with an
   * agency until a staffer confirms who it is, whichever blocker heads it.
   */
  it("offers no agency check on a held seat, even with a pending card", () => {
    for (const blockers of [
      [blocker("certification_pending"), blocker("identity_unconfirmed")],
      [blocker("identity_unconfirmed"), blocker("certification_pending")],
    ]) {
      for (const aboard of [false, true]) {
        const held = diverBlockerAction({ ...input, blockers, aboard }, "blue-reef", NOW);
        expect(held?.agencyCheck).toBeUndefined();
      }
    }
  });

  it("says the headline blocker in a few words, and nothing about the rest", () => {
    // The record the row opens lists every blocker in full; the row names the
    // one the tap fixes (Aaron, 2026-10-05: "reduce the amount of copy").
    const result = diverBlockerAction(
      {
        ...input,
        blockers: [blocker("medical_review"), blocker("payment_due"), blocker("waiver_pending")],
      },
      "blue-reef",
      NOW,
    );
    expect(result?.detail).toBe("Medical answer needs a doctor’s sign-off.");
  });

  // Issue #2124: held seats get no readiness reminder until staff confirm who it is.
  it("says a held seat's reminders wait on the confirm", () => {
    const result = diverBlockerAction(
      { ...input, blockers: [blocker("identity_unconfirmed")] },
      "blue-reef",
      NOW,
    );
    expect(result?.detail).toBe(
      "Booking matched on a guess. Confirm who this is before the waiver goes out.",
    );
  });

  it("says a cert gap without the levels, which the record carries", () => {
    const result = diverBlockerAction(
      {
        ...input,
        blockers: [
          {
            code: "certification_insufficient",
            params: { requiredLevel: "advanced_open_water", heldLevel: "open_water" },
          },
        ],
      },
      "blue-reef",
      NOW,
    );
    expect(result?.detail).toBe("Not certified for this trip");
  });

  it("leads an aboard diver's row with the missing waiver, not the card", () => {
    // Aboard, an unsigned waiver is a missing medical declaration; ashore the
    // card ranks first because it takes longer to fix (dive-domain-expert).
    const blockers = [blocker("certification_insufficient"), blocker("waiver_pending")];
    expect(diverBlockerAction({ ...input, blockers }, "blue-reef", NOW)?.detail).toBe(
      "Not certified for this trip",
    );
    const aboard = diverBlockerAction({ ...input, blockers, aboard: true }, "blue-reef", NOW);
    expect(aboard?.kind).toBe("blocked_aboard");
    expect(aboard?.detail).toBe("Waiver not signed, link sent");
  });

  it("never makes an Aboard row out of money owed", () => {
    const result = diverBlockerAction(
      { ...input, blockers: [blocker("payment_due")], aboard: true },
      "blue-reef",
      NOW,
    );
    expect(result?.kind).toBe("payment");
  });

  it("says a medical hold aboard as a doctor's call, to the boat roles too", () => {
    // Deliberate: the departure card said "a medical hold" by name to every
    // Today viewer before this row replaced it, and the person at the rail is
    // who needs to know (dive-domain-expert and security-reviewer, 2026-10-05).
    const result = diverBlockerAction(
      { ...input, blockers: [blocker("medical_review")], aboard: true },
      "blue-reef",
      NOW,
    );
    expect(result?.detail).toBe("Medical answer needs a doctor’s sign-off.");
    if (!result) throw new Error("expected a row");
    expect(filterActionsForRoles([result], ["captain"])).toHaveLength(1);
    expect(filterActionsForRoles([result], ["divemaster"])).toHaveLength(1);
  });

  it("takes the aboard kind once the diver is on the boat, keeping the fix", () => {
    const result = diverBlockerAction({ ...input, aboard: true }, "blue-reef", NOW);
    expect(result?.kind).toBe("blocked_aboard");
    expect(result?.detail).toBe("Waiver not signed, not sent yet");
    expect(result?.waiver).toEqual({ bookingIds: ["b1"] });
  });

  it("produces nothing for a diver with no blockers", () => {
    expect(diverBlockerAction({ ...input, blockers: [] }, "blue-reef", NOW)).toBeNull();
  });

  it("marks a payment_due row with the single booking it can act on in place", () => {
    const result = diverBlockerAction(
      { ...input, blockers: [blocker("payment_due")] },
      "blue-reef",
      NOW,
    );
    // Only the bookingId — src/db/today.ts fills in orderId/hostedInvoiceUrl
    // once it knows the booking was actually invoiced through Stripe.
    expect(result?.payment).toEqual({ bookingId: "b1" });
    expect(result?.payment?.orderId).toBeUndefined();
  });

  it("marks a payment_refunded row the same way", () => {
    const result = diverBlockerAction(
      { ...input, blockers: [blocker("payment_refunded")] },
      "blue-reef",
      NOW,
    );
    expect(result?.payment).toEqual({ bookingId: "b1" });
  });

  it("never marks a non-payment row for the inline payment control", () => {
    const result = diverBlockerAction(input, "blue-reef", NOW);
    expect(result?.payment).toBeUndefined();
  });
});

describe("Needs you ordering of the roll call (sortStationRows)", () => {
  it("puts an unfinished roll call ahead of a medical review on the same boat", () => {
    // Both are danger and share a `dueAt`, so severity breaks the tie, and
    // nothing outranks the count that says whether everyone came back.
    const at = hoursFromNow(-1);
    const sorted = sortStationRows([
      action({ id: "med", kind: "medical_review", urgency: "imminent", dueAt: at }),
      action({ id: "roll", kind: "roll_call_unfinished", urgency: "imminent", dueAt: at }),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(["roll", "med"]);
  });
});

describe("roleLensFor", () => {
  it("gives owners and managers no lens, whatever else they hold", () => {
    expect(roleLensFor(["owner"])).toBeNull();
    expect(roleLensFor(["manager", "instructor", "captain"])).toBeNull();
  });

  it("leads instructors with sessions, boat crew with their boat", () => {
    expect(roleLensFor(["instructor"])).toBe("sessions");
    expect(roleLensFor(["captain"])).toBe("boat");
    expect(roleLensFor(["divemaster"])).toBe("boat");
    // Instructor wins for someone holding both, matching switcher precedence.
    expect(roleLensFor(["captain", "instructor"])).toBe("sessions");
    expect(roleLensFor(["diver"])).toBeNull();
    expect(roleLensFor([])).toBeNull();
  });
});

describe("roll-call gap ranking (DOM-H3)", () => {
  it("ranks a diver who did not come back above every other row on the boat", () => {
    // Severity is what breaks the tie once two rows share a `dueAt`. A crew
    // member said a diver is not back aboard; nothing on this queue outranks
    // that, and the unfinished-count row is the strongest thing it has to beat.
    const at = hoursFromNow(-1);
    const sorted = sortStationRows([
      action({ id: "dock", kind: "roll_call_departure_open", urgency: "imminent", dueAt: at }),
      action({ id: "none", kind: "roll_call_not_started", urgency: "imminent", dueAt: at }),
      action({ id: "open", kind: "roll_call_unfinished", urgency: "imminent", dueAt: at }),
      action({ id: "missing", kind: "roll_call_missing_diver", urgency: "imminent", dueAt: at }),
      action({ id: "crewOpen", kind: "roll_call_crew_unfinished", urgency: "imminent", dueAt: at }),
      action({ id: "crewMissing", kind: "roll_call_missing_crew", urgency: "imminent", dueAt: at }),
      action({ id: "med", kind: "medical_review", urgency: "imminent", dueAt: at }),
    ]);
    // The four after-dive kinds lead — a crew member who did not come back sits
    // beside the diver row, not below the clerical ones (review 20260803, D1) —
    // then the diver blocker, and the two dock-count kinds ride last.
    expect(sorted.map((entry) => entry.id)).toEqual([
      "missing",
      "crewMissing",
      "open",
      "crewOpen",
      "med",
      "dock",
      "none",
    ]);
  });

  it("pins the after-dive gaps to the top band and drops the dock counts a band", () => {
    // An unfinished dock count is real work, but it is not "a person may be in
    // the water" — putting both in the same band is what turns the red row into
    // wallpaper.
    expect(rollCallGapUrgency("missing_diver", false)).toBe("imminent");
    expect(rollCallGapUrgency("after_dive_uncounted", false)).toBe("imminent");
    // Crew ride the identical schedule: a crew member is not less findable
    // than a customer (review 20260803, D1).
    expect(rollCallGapUrgency("missing_crew", false)).toBe("imminent");
    expect(rollCallGapUrgency("crew_uncounted", false)).toBe("imminent");
    expect(rollCallGapUrgency("departure_uncounted", false)).toBe("now");
    expect(rollCallGapUrgency("no_roll_call", false)).toBe("now");
  });

  it("ages an unclosed after-dive count down a band instead of to nothing", () => {
    // Past the dock-work window the row used to vanish outright, with nothing
    // anywhere recording that a count had never closed. It degrades instead.
    expect(rollCallGapUrgency("missing_diver", true)).toBe("soon");
    expect(rollCallGapUrgency("after_dive_uncounted", true)).toBe("soon");
    expect(rollCallGapUrgency("missing_crew", true)).toBe("soon");
    expect(rollCallGapUrgency("crew_uncounted", true)).toBe("soon");
  });
});

describe("filterActionsForRoles", () => {
  const sampleActions = [
    action({ id: "1", kind: "roll_call_missing_diver" }),
    action({ id: "2", kind: "dive_prep" }),
    action({ id: "3", kind: "nitrox_gate" }),
    action({ id: "4", kind: "certification" }),
    action({ id: "5", kind: "waiver" }),
    action({ id: "6", kind: "payment" }),
    action({ id: "7", kind: "seat_wanted" }),
    action({ id: "8", kind: "gear_due_back" }),
  ];

  it("shows all actions to an owner", () => {
    const result = filterActionsForRoles(sampleActions, ["owner"]);
    expect(result).toHaveLength(8);
  });

  it("shows all actions to a manager", () => {
    const result = filterActionsForRoles(sampleActions, ["manager"]);
    expect(result).toHaveLength(8);
  });

  it("filters out clerical and commercial rows for a captain", () => {
    const result = filterActionsForRoles(sampleActions, ["captain"]);
    expect(result.map((a) => a.id)).toEqual(["1", "2", "3", "8"]);
  });

  it("filters out clerical and commercial rows for a divemaster", () => {
    const result = filterActionsForRoles(sampleActions, ["divemaster"]);
    expect(result.map((a) => a.id)).toEqual(["1", "2", "3", "8"]);
  });

  it("shows certs and waivers to an instructor but withholds payment and deals", () => {
    const result = filterActionsForRoles(sampleActions, ["instructor"]);
    expect(result.map((a) => a.id)).toEqual(["1", "2", "3", "4", "5", "8"]);
  });

  it("shows the union for a person holding multiple roles", () => {
    const result = filterActionsForRoles(sampleActions, ["captain", "instructor"]);
    expect(result.map((a) => a.id)).toEqual(["1", "2", "3", "4", "5", "8"]);
  });

  it("returns the whole queue when there is no viewer to filter for", () => {
    // **Not a fail-open default — the absence of a viewer.** The lens narrows a
    // screen to the person reading it, and the two callers that render one
    // (`src/app/shop/[shopSlug]/page.tsx`) always pass `session.user.roles`,
    // which `requireStaffSession` guarantees is non-empty. A call with no
    // viewer is a reading of the shop's whole day, and one that dropped every
    // owed refund because nobody was looking would be a falsified reading
    // rather than a tightened gate.
    const noRoles = filterActionsForRoles(sampleActions, undefined);
    expect(noRoles).toHaveLength(8);
    expect(filterActionsForRoles(sampleActions, [])).toHaveLength(8);
  });
});

/**
 * **The day spine files work; it never re-detects it** (ADR
 * 20260827-clearwater-surface-language, decision 4). Everything below asks the
 * same question: given a queue `getTodayWork` already produced and ranked, does
 * every row land where the design says, and does nothing appear twice?
 */
function departure(overrides: Partial<SpineDeparture> = {}): SpineDeparture {
  return {
    tripId: "t1",
    title: "Two-Tank Reef",
    startsAt: hoursFromNow(2),
    endsAt: hoursFromNow(5),
    siteName: "Molasses Reef",
    courseTitle: null,
    boatName: "Mantis II",
    priceCents: 9500,
    capacity: 12,
    booked: 10,
    boarded: 0,
    blocked: 0,
    crew: [{ fullName: "Keiko Tanaka" }],
    crewAccountedFor: true,
    crewReason: null,
    rehearsal: false,
    ...overrides,
    sellableCapacity: overrides.sellableCapacity ?? overrides.capacity ?? 12,
  };
}

const boat = (tripId: string, label = "Reef") => ({ tripId, label });

describe("assembleDaySpine", () => {
  it("files a row under the station of the trip it names, and a row with no trip at the desk", () => {
    const spine = assembleDaySpine(
      {
        departures: [departure()],
        actions: [
          action({ id: "on-boat", departure: boat("t1") }),
          action({ id: "at-desk", kind: "reviews_pending", departure: undefined }),
        ],
      },
      { departures: [], actions: [] },
    );
    expect(spine.stations.map((station) => station.rows.map((row) => row.id))).toEqual([
      ["on-boat"],
    ]);
    expect(spine.desk.map((row) => row.id)).toEqual(["at-desk"]);
  });

  it("orders stations by the clock, whoever is reading", () => {
    // The departure board led with the boat the signed-in staffer crewed. The
    // spine does not: a clock that puts 1:00 PM above 7:00 AM for one reader is
    // no longer a clock (a deliberate change, decision 4).
    const spine = assembleDaySpine(
      {
        departures: [
          departure({ tripId: "afternoon", startsAt: hoursFromNow(6), endsAt: hoursFromNow(9) }),
          departure({ tripId: "morning", startsAt: hoursFromNow(1), endsAt: hoursFromNow(4) }),
        ],
        actions: [],
      },
      { departures: [], actions: [] },
    );
    expect(spine.stations.map((station) => station.tripId)).toEqual(["morning", "afternoon"]);
  });

  it("reads two boats at the same minute by title, whatever ids the seed minted", () => {
    // An id-only tiebreak swapped two 7:30 cards between two CI runs: ids are
    // fresh per seed, so the same board came out in two orders.
    const at = hoursFromNow(1);
    for (const [first, second] of [
      ["a-id", "z-id"],
      ["z-id", "a-id"],
    ]) {
      const spine = assembleDaySpine(
        {
          departures: [
            departure({
              tripId: first,
              title: "Two-Tank Reef",
              startsAt: at,
              endsAt: hoursFromNow(4),
            }),
            departure({
              tripId: second,
              title: "Morning Two-Tank",
              startsAt: at,
              endsAt: hoursFromNow(4),
            }),
          ],
          actions: [],
        },
        { departures: [], actions: [] },
      );
      expect(spine.stations.map((station) => station.title)).toEqual([
        "Morning Two-Tank",
        "Two-Tank Reef",
      ]);
    }
  });

  it("ranks a station's rows danger, then warning, then quiet", () => {
    const spine = assembleDaySpine(
      {
        departures: [departure()],
        actions: [
          action({ id: "quiet", kind: "dive_prep", departure: boat("t1") }),
          action({ id: "danger", kind: "medical_review", departure: boat("t1") }),
          action({ id: "warning", kind: "waiver", departure: boat("t1") }),
        ],
      },
      { departures: [], actions: [] },
    );
    expect(spine.stations[0]?.rows.map((row) => row.id)).toEqual(["danger", "warning", "quiet"]);
  });

  it("flattens the crew to names and carries the station's own site, boat and price", () => {
    const spine = assembleDaySpine(
      {
        departures: [
          departure({ crew: [{ fullName: "Keiko Tanaka" }, { fullName: "Sal Moretti" }] }),
        ],
        actions: [],
      },
      { departures: [], actions: [] },
    );
    expect(spine.stations[0]?.crewNames).toEqual(["Keiko Tanaka", "Sal Moretti"]);
    expect(spine.stations[0]?.siteName).toBe("Molasses Reef");
    expect(spine.stations[0]?.boatName).toBe("Mantis II");
    expect(spine.stations[0]?.priceCents).toBe(9500);
  });

  it("hangs tomorrow's rows off tomorrow's own departures, and counts the rest as the week", () => {
    const spine = assembleDaySpine(
      {
        departures: [departure()],
        actions: [
          action({ id: "today", departure: boat("t1") }),
          action({ id: "tomorrow", departure: boat("t2") }),
          action({ id: "friday", departure: boat("t9") }),
        ],
      },
      { departures: [departure({ tripId: "t2", startsAt: hoursFromNow(26) })], actions: [] },
    );
    expect(spine.tomorrow.stations.map((station) => station.tripId)).toEqual(["t2"]);
    expect(spine.tomorrow.stations[0]?.rows.map((row) => row.id)).toEqual(["tomorrow"]);
    expect(spine.tomorrow.jobs).toBe(1);
    expect(spine.week.jobs).toBe(1);
  });

  it("lists a boat that is out in Needs you, not under the week's count", () => {
    // A departure an hour past sailing has no live station any more, and its
    // rows used to fall through to the week's count: a blocked diver aboard,
    // or a diver recorded not back, was a number behind a link (issue #2064).
    const spine = assembleDaySpine(
      {
        departures: [departure()],
        actions: [
          action({ id: "aboard", kind: "blocked_aboard", departure: boat("out") }),
          action({ id: "friday", departure: boat("t9") }),
        ],
        outTripIds: ["out"],
      },
      { departures: [], actions: [] },
    );
    expect(spine.desk.map((row) => row.id)).toEqual(["aboard"]);
    expect(spine.week.jobs).toBe(1);
    expect(spineJobCount(spine)).toBe(2);
  });

  it("lists an open after-dive count on a boat that is back in Needs you, not the week", () => {
    // Crew tapped home with a diver still recorded not back, or last night's
    // boat inside the residue window: no station, not out, and still a person
    // who may be in the water (issue #2131).
    const spine = assembleDaySpine(
      {
        departures: [departure()],
        actions: [
          action({
            id: "roll-call:back:missing_diver:after_dive_1",
            kind: "roll_call_missing_diver",
            departure: boat("back"),
          }),
          action({
            id: "roll-call:back:missing_crew:after_dive_1",
            kind: "roll_call_missing_crew",
            departure: boat("back"),
          }),
          action({
            id: "roll-call:back:after_dive_uncounted:after_dive_1",
            kind: "roll_call_unfinished",
            departure: boat("back"),
          }),
        ],
      },
      { departures: [], actions: [] },
    );
    expect(spine.desk.map((row) => row.id).sort()).toEqual([
      "roll-call:back:after_dive_uncounted:after_dive_1",
      "roll-call:back:missing_crew:after_dive_1",
      "roll-call:back:missing_diver:after_dive_1",
    ]);
    expect(spine.week.jobs).toBe(0);
    expect(spineJobCount(spine)).toBe(3);
  });

  it("leaves a returned boat's dock paperwork in the week's count", () => {
    const spine = assembleDaySpine(
      {
        departures: [departure()],
        actions: [
          action({
            id: "roll-call:back:departure_uncounted:departure",
            kind: "roll_call_departure_open",
            departure: boat("back"),
          }),
        ],
      },
      { departures: [], actions: [] },
    );
    expect(spine.desk).toEqual([]);
    expect(spine.week.jobs).toBe(1);
  });

  it("keeps an after-dive count on its station while the boat still has one", () => {
    const spine = assembleDaySpine(
      {
        departures: [departure()],
        actions: [
          action({ id: "missing", kind: "roll_call_missing_diver", departure: boat("t1") }),
        ],
      },
      { departures: [], actions: [] },
    );
    expect(spine.stations[0]?.rows.map((row) => row.id)).toEqual(["missing"]);
    expect(spine.desk).toEqual([]);
  });

  it("keeps a boat's rows on its station while it still has one", () => {
    const spine = assembleDaySpine(
      {
        departures: [departure()],
        actions: [action({ id: "on-boat", departure: boat("t1") })],
        outTripIds: ["t1"],
      },
      { departures: [], actions: [] },
    );
    expect(spine.stations[0]?.rows.map((row) => row.id)).toEqual(["on-boat"]);
    expect(spine.desk).toEqual([]);
  });

  it("counts every row exactly once, wherever its boat sails", () => {
    const spine = assembleDaySpine(
      {
        departures: [departure()],
        actions: [
          action({ id: "today", departure: boat("t1") }),
          action({ id: "tomorrow", departure: boat("t2") }),
          action({ id: "friday", departure: boat("t9") }),
          action({ id: "desk", departure: undefined }),
        ],
      },
      { departures: [departure({ tripId: "t2" })], actions: [] },
    );
    expect(spineJobCount(spine)).toBe(4);
  });

  it("renders no station for a day with no departures", () => {
    const spine = assembleDaySpine(
      { departures: [], actions: [action({ id: "desk", departure: undefined })] },
      { departures: [], actions: [] },
    );
    expect(spine.stations).toEqual([]);
    expect(spine.tomorrow.stations).toEqual([]);
    expect(spine.desk).toHaveLength(1);
  });
});

describe("sortStationRows", () => {
  it("does not mutate its input", () => {
    const input = [
      action({ id: "quiet", kind: "dive_prep" }),
      action({ id: "danger", kind: "medical_review" }),
    ];
    sortStationRows(input);
    expect(input.map((row) => row.id)).toEqual(["quiet", "danger"]);
  });
});

/**
 * **Saying hello is not a job** (fifth loop, item 10). A greeting has no done
 * state, so it is a line on the departure card (`SpineDeparture.welcome`) and
 * the roster's own cue, never a Needs you row or a number in its count.
 */
describe("saying hello", () => {
  it("is not a kind the queue can hold", () => {
    expect(Object.keys(ACTION_KIND_META)).not.toContain("say_hello");
    expect(Object.keys(KIND_AUDIENCE)).not.toContain("say_hello");
  });
});

/**
 * **A waiting diver reaches everyone** (issues #1505/#1518). The inbox carried
 * an owner/manager gate until 2026-09-10, and this row was narrowed to match
 * it; the owner opened both, so the row follows. Pinned per role rather than
 * left to the registry literal, because the failure this guards against is
 * quiet: a narrowed row does not error, it just stops telling the person at
 * the dock that a diver is waiting.
 */
describe("the unanswered-messages row", () => {
  it("reaches every staff role, because every staff role may answer it", () => {
    for (const role of [
      "owner",
      "manager",
      "instructor",
      "divemaster",
      "captain",
      "crew",
    ] as const) {
      expect(filterActionsForRoles([action({ kind: "unanswered_messages" })], [role])).toHaveLength(
        1,
      );
    }
  });
});

/**
 * **The desk fixes a bounce** (issue #2066). `resendConfirmationAction` is
 * open to every staff role, like the invoice and waiver resends, so the row
 * that offers it is too. A row narrower than its action hides a fixable bounce
 * from the person standing at the counter.
 */
describe("the failed-email row", () => {
  it("reaches every staff role, because every staff role may resend it", () => {
    for (const role of [
      "owner",
      "manager",
      "instructor",
      "assistant_instructor",
      "divemaster",
      "captain",
      "crew",
    ] as const) {
      expect(filterActionsForRoles([action({ kind: "email_delivery" })], [role])).toHaveLength(1);
    }
  });
});

/**
 * **The quiet day** — the composition's other silence, and the one that decides
 * whether the spine renders at all (SPEC 6c's pinned pair, "A quiet day at the
 * dock." over "No boats today, and nothing is waiting on you.").
 */
describe("spineIsQuiet", () => {
  const empty = () =>
    assembleDaySpine({ departures: [], actions: [] }, { departures: [], actions: [] });

  it("collapses a day with no boat and nothing waiting anywhere", () => {
    expect(spineIsQuiet(empty(), false, 0)).toBe(true);
  });

  it("is not quiet while a boat is on the spine, however clear it is", () => {
    const spine = assembleDaySpine(
      { departures: [departure()], actions: [] },
      { departures: [], actions: [] },
    );
    expect(spineIsQuiet(spine, false, 1)).toBe(false);
  });

  it("is not quiet while a job waits at the desk, on tomorrow, or later in the week", () => {
    const desk = assembleDaySpine(
      {
        departures: [],
        actions: [action({ id: "stuck", kind: "stuck_payment_operation", departure: undefined })],
      },
      { departures: [], actions: [] },
    );
    expect(spineIsQuiet(desk, false, 0)).toBe(false);

    const week = assembleDaySpine(
      { departures: [], actions: [action({ id: "later", kind: "waiver", departure: boat("t9") })] },
      { departures: [], actions: [] },
    );
    expect(spineIsQuiet(week, false, 0)).toBe(false);

    const tomorrow = assembleDaySpine(
      {
        departures: [],
        actions: [action({ id: "tmw", kind: "waiver", departure: boat("t2") })],
      },
      { departures: [departure({ tripId: "t2" })], actions: [] },
    );
    expect(spineIsQuiet(tomorrow, false, 0)).toBe(false);
  });

  it("is not quiet on an evening whose only boat is already home", () => {
    // The spine's stations are forward-looking, so a departure that ended an
    // hour ago is not on them — and a page collapsing to "No boats today" over
    // a settled station is the same lie the desk-row clause below refuses (ADR
    // 20260827-clearwater-surface-language, decision 4).
    expect(spineIsQuiet(empty(), false, 1)).toBe(false);
  });

  it("is not quiet while a presence-derived desk row stands, which no job count can see", () => {
    // "Nothing is waiting on you" over a payments row the reader can see on the
    // same screen is a lie (ADR 20260827-first-light, decision 6).
    expect(spineIsQuiet(empty(), true, 0)).toBe(false);
  });

  it("is never quiet on a shop's first morning — the two compositions are exclusive", () => {
    // **The pin** (slice 10d, ADR 20260827-first-light, decision 6). A shop
    // that has never had a board is not having a quiet day: its spine is empty
    // by every other measure here, and the setup ledger leads it. Collapsing to
    // "A quiet day at the dock." over the three steps that are the whole screen
    // answers a question the owner never asked.
    expect(spineIsQuiet(empty(), false, 0, true)).toBe(false);
    expect(spineIsQuiet(empty(), false, 0, false)).toBe(true);
  });
});

/**
 * The morning good-news moment (principles.md §3, and the coral budget's "The
 * home, morning" row). Every case here is a **silence** as much as a sentence:
 * this line renders nothing at all when it is not true, which is the whole
 * discipline the ADR's coral table is enforcing.
 */
describe("todaysBoatsAreClear", () => {
  const spineWith = (rows: TodayAction[], desk: TodayAction[] = []) =>
    assembleDaySpine(
      {
        departures: [departure()],
        actions: [...rows, ...desk],
      },
      { departures: [], actions: [] },
    );

  it("fires once today's boats carry nothing pressing but work remains elsewhere", () => {
    const spine = assembleDaySpine(
      {
        departures: [departure()],
        actions: [
          action({ id: "quiet", kind: "dive_prep", departure: boat("t1") }),
          action({ id: "later", kind: "waiver", departure: boat("t9") }),
        ],
      },
      { departures: [], actions: [] },
    );
    expect(todaysBoatsAreClear(spine)).toBe(true);
  });

  it("stays silent while a station still carries a warning or a danger row", () => {
    expect(
      todaysBoatsAreClear(spineWith([action({ id: "w", kind: "waiver", departure: boat("t1") })])),
    ).toBe(false);
    expect(
      todaysBoatsAreClear(
        spineWith([action({ id: "d", kind: "medical_review", departure: boat("t1") })]),
      ),
    ).toBe(false);
  });

  it("stays silent while the desk group carries one", () => {
    // The desk is today's work too — a stuck payment operation is not "the
    // boats are clear" just because it has no boat.
    const spine = assembleDaySpine(
      {
        departures: [departure()],
        actions: [
          action({ id: "quiet", kind: "dive_prep", departure: boat("t1") }),
          action({ id: "stuck", kind: "stuck_payment_operation", departure: undefined }),
          action({ id: "later", kind: "waiver", departure: boat("t9") }),
        ],
      },
      { departures: [], actions: [] },
    );
    expect(todaysBoatsAreClear(spine)).toBe(false);
  });

  it("renders nothing on a day with no boats at all", () => {
    const spine = assembleDaySpine(
      { departures: [], actions: [action({ id: "later", kind: "waiver", departure: boat("t9") })] },
      { departures: [], actions: [] },
    );
    expect(todaysBoatsAreClear(spine)).toBe(false);
  });

  it("yields to the other good-news moment when nothing is waiting anywhere", () => {
    // "Nothing is waiting on you" is the whole-week moment; the two have never
    // both rendered at once, and this is what keeps that true.
    const spine = assembleDaySpine(
      { departures: [departure()], actions: [] },
      { departures: [], actions: [] },
    );
    expect(spineJobCount(spine)).toBe(0);
    expect(todaysBoatsAreClear(spine)).toBe(false);
  });
});

/**
 * **Today's sentence, its "Needs you" count and the all-clear line are one
 * reading, for every role** (UX review 2026-10-10, item 2).
 *
 * The regression: a captain's Today said "Nothing needs you before the 6:30 PM
 * leaves the dock" directly above "Needs you · 2 things" about that boat, and
 * "Today's boats are all clear" under a card saying "1 blocked". The sentence
 * counted warning rows across the shop, the list counted the reader's lens,
 * and the line ignored the blocked diver the lens had withheld.
 *
 * Each role below reads the day the page reads it: the queue filtered for the
 * role (`filterActionsForRoles`), the lens the page passes (`roleLensFor`:
 * a crew lens names the boats the reader crews, everyone else names none).
 */
describe("readNeedsYou, one reading for every role", () => {
  const evening = departure({
    tripId: "t1",
    title: "Two-Tank Reef",
    blocked: 1,
    booked: 11,
  });
  const queue = [
    // The blocked diver's fix: the desk's, withheld from a captain's lens.
    action({ id: "waiver", kind: "waiver", subject: "Priya", departure: boat("t1") }),
    action({ id: "prep", kind: "dive_prep", subject: "4 sizes", departure: boat("t1") }),
    action({ id: "fill", kind: "seat_wanted", subject: "3 seats", departure: boat("t1") }),
    action({ id: "messages", kind: "unanswered_messages", subject: "3", departure: undefined }),
  ];
  const ROLES = [
    { role: "owner", crews: false },
    { role: "captain", crews: true },
    { role: "divemaster", crews: true },
    { role: "instructor", crews: false },
  ] as const;

  function readFor(role: (typeof ROLES)[number]) {
    const visibleActions = filterActionsForRoles(queue, [role.role]);
    const spine = assembleDaySpine(
      { departures: [evening], actions: visibleActions },
      { departures: [], actions: [] },
    );
    const lens = roleLensFor([role.role]);
    return readNeedsYou(spine, {
      crewedTripIds: lens === "boat" && role.crews ? ["t1"] : [],
      readerPersonId: "me",
      blocked: 1,
      now: NOW,
    });
  }

  it.each(ROLES)(
    "the $role's sentence counts exactly the list's rows about the next boat",
    (role) => {
      const reading = readFor(role);
      expect(reading.next?.tripId).toBe("t1");
      const aboutNext = reading.lead.filter((row) => row.departure?.tripId === "t1");
      expect(reading.dueBeforeNext).toBe(aboutNext.length);
      // The list says how long it is with the same rows it draws.
      expect(reading.count).toBe(reading.lead.length);
      // "Nothing needs you before the 6:30 PM" can never sit over rows about it.
      if (aboutNext.length > 0) expect(reading.dueBeforeNext).toBeGreaterThan(0);
    },
  );

  it.each(ROLES)(
    "never tells the $role today's boats are clear while one carries a blocked diver",
    (role) => {
      expect(readFor(role).boatsClear).toBe(false);
    },
  );

  it("reads the captain's day as the captain's list: one thing, before the boat", () => {
    const reading = readFor({ role: "captain", crews: true });
    // No greeting row: saying hello is a line on the card (fifth loop, item 10).
    expect(reading.lead.map((row) => row.id)).toEqual(["prep"]);
    expect(reading.count).toBe(1);
    expect(reading.dueBeforeNext).toBe(1);
    // The desk's messages fold behind one line; they are not the boat's.
    expect(reading.folded?.map((row) => row.id)).toEqual(["messages"]);
  });

  it("reads the owner's day whole, with the desk's row counted but not as due before the boat", () => {
    const reading = readFor({ role: "owner", crews: false });
    expect(reading.count).toBe(4);
    expect(reading.dueBeforeNext).toBe(3);
    expect(reading.folded).toBeNull();
  });

  it("counts the whole list once every boat is away, drafts and the payments row with it", () => {
    const spine = assembleDaySpine(
      {
        departures: [departure({ startsAt: hoursFromNow(-3), endsAt: hoursFromNow(1) })],
        actions: [action({ id: "messages", kind: "unanswered_messages", departure: undefined })],
      },
      { departures: [], actions: [] },
    );
    const reading = readNeedsYou(spine, { drafts: 1, paymentsRow: true, now: NOW });
    expect(reading.next).toBeNull();
    expect(reading.count).toBe(3);
    expect(reading.dueBeforeNext).toBe(3);
  });

  it("still earns the all-clear on a day with nothing pressing and nobody blocked", () => {
    const spine = assembleDaySpine(
      {
        departures: [departure()],
        actions: [action({ id: "prep", kind: "dive_prep", departure: boat("t1") })],
      },
      { departures: [], actions: [] },
    );
    expect(readNeedsYou(spine, { now: NOW }).boatsClear).toBe(true);
    expect(readNeedsYou(spine, { now: NOW, blocked: 1 }).boatsClear).toBe(false);
  });
});

describe("one fact of scale", () => {
  const seat = (diverName: string, hour: number, seenEarlierThisSeason = false) => ({
    personId: `p-${diverName}`,
    diverName,
    departureAt: new Date(`2026-07-21T${String(hour).padStart(2, "0")}:00:00.000Z`),
    seenEarlierThisSeason,
  });
  const season = { month: 5, day: 1 };

  it("says nothing on an ordinary day", () => {
    expect(
      factOfScaleFor({
        seasonStart: season,
        diversBefore: 42,
        todaySeats: [seat("Ada Lindqvist", 11), seat("Hugo Marsh", 17)],
        firstBoatOfSeason: false,
      }),
    ).toBeNull();
  });

  it("says nothing on a day with no seats and no boat", () => {
    expect(
      factOfScaleFor({
        seasonStart: season,
        diversBefore: 99,
        todaySeats: [],
        firstBoatOfSeason: false,
      }),
    ).toBeNull();
  });

  it("names the seat that crosses the hundred, not the day's first", () => {
    const fact = factOfScaleFor({
      seasonStart: season,
      diversBefore: 98,
      todaySeats: [seat("Ada Lindqvist", 11), seat("Ben Okafor", 11), seat("Hugo Marsh", 17)],
      firstBoatOfSeason: false,
    });
    expect(fact).toEqual({
      kind: "divers",
      count: 100,
      diverName: "Ben Okafor",
      departureAt: new Date("2026-07-21T11:00:00.000Z"),
      seasonStart: season,
    });
  });

  it("says the first hundred a day crosses and never the second", () => {
    const fact = factOfScaleFor({
      seasonStart: season,
      diversBefore: 99,
      todaySeats: Array.from({ length: 105 }, (_, i) => seat(`Diver ${i}`, 11)),
      firstBoatOfSeason: false,
    });
    expect(fact).toMatchObject({ kind: "divers", count: 100, diverName: "Diver 0" });
  });

  it("says nothing when the hundred was passed before today", () => {
    expect(
      factOfScaleFor({
        seasonStart: season,
        diversBefore: 100,
        todaySeats: [seat("Ada Lindqvist", 11)],
        firstBoatOfSeason: false,
      }),
    ).toBeNull();
  });

  it("counts a diver once, however many of today's boats they are on", () => {
    const ada = seat("Ada Lindqvist", 11);
    const fact = factOfScaleFor({
      seasonStart: season,
      diversBefore: 99,
      todaySeats: [ada, { ...ada, departureAt: new Date("2026-07-21T17:00:00.000Z") }],
      firstBoatOfSeason: false,
    });
    // The second seat is the same person, so it never reaches 101 — and the
    // 100th is the first one.
    expect(fact).toMatchObject({ kind: "divers", count: 100, diverName: "Ada Lindqvist" });
  });

  it("does not count a diver who already dived this season", () => {
    expect(
      factOfScaleFor({
        seasonStart: season,
        diversBefore: 99,
        todaySeats: [seat("Ada Lindqvist", 11, true)],
        firstBoatOfSeason: false,
      }),
    ).toBeNull();
  });

  it("names the first diver who is new, past the regulars ahead of them", () => {
    const fact = factOfScaleFor({
      seasonStart: season,
      diversBefore: 99,
      todaySeats: [seat("Ada Lindqvist", 11, true), seat("Ben Okafor", 11), seat("Hugo Marsh", 17)],
      firstBoatOfSeason: false,
    });
    expect(fact).toMatchObject({ kind: "divers", count: 100, diverName: "Ben Okafor" });
  });

  it("lets the season's first boat outrank its hundredth diver", () => {
    expect(
      factOfScaleFor({
        seasonStart: season,
        diversBefore: 99,
        todaySeats: [seat("Ben Okafor", 11)],
        firstBoatOfSeason: true,
      }),
    ).toEqual({ kind: "first_boat", seasonStart: season });
  });
});
/**
 * **Five refunds owed on one cancelled boat is one job, not five** (ADR
 * 20260911-clear-the-deck; principle 9). Each row used to repeat "You
 * cancelled the departure and the money couldn’t go back by card" at equal
 * weight, so a staffer read one fact five times and the five names were the
 * only thing that differed.
 */
describe("collapseOwedRefunds", () => {
  const seat = (overrides: Partial<OwedRefundInput> = {}): OwedRefundInput => ({
    bookingId: "b1",
    diverName: "Ana Ruiz",
    tripId: "t1",
    tripTitle: "Wreck Trip — Spiegel Grove",
    when: "Tue, Jul 21",
    amountCents: 13_200,
    currency: "usd",
    ...overrides,
  });

  it("leaves one owed seat exactly as it was: the diver is the row", () => {
    const [row, ...rest] = collapseOwedRefunds([seat()], "blue-reef", "en-US");
    expect(rest).toHaveLength(0);
    expect(row?.id).toBe("owed-refund:b1");
    expect(row?.subject).toBe("Ana Ruiz");
    expect(row?.detail).toContain("$132.00");
    expect(row?.href).toBe("/shop/blue-reef/trips/t1");
  });

  it("collapses a departure that owes several seats into one row that names them", () => {
    const rows = collapseOwedRefunds(
      [
        seat({ bookingId: "b1", diverName: "Ana Ruiz" }),
        seat({ bookingId: "b2", diverName: "Ben Cole" }),
        seat({ bookingId: "b3", diverName: "Cara Diaz" }),
      ],
      "blue-reef",
      "en-US",
    );

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.id).toBe("owed-refunds:t1");
    expect(row?.subject).toBe("3 refunds owed");
    // The money, the boat and everyone waiting — and the sentence about why it
    // is owed exactly once.
    expect(row?.detail).toContain("$396.00");
    expect(row?.detail).toContain("Ana Ruiz, Ben Cole and Cara Diaz");
    expect(row?.detail?.match(/mark each seat refunded/g)).toHaveLength(1);
    expect(row?.href).toBe("/shop/blue-reef/trips/t1");
  });

  it("keeps one row per departure, never one across boats", () => {
    const rows = collapseOwedRefunds(
      [
        seat({ bookingId: "b1" }),
        seat({ bookingId: "b2", diverName: "Ben Cole" }),
        seat({ bookingId: "b3", tripId: "t2", tripTitle: "Night Dive", diverName: "Cara Diaz" }),
      ],
      "blue-reef",
      "en-US",
    );
    expect(rows.map((row) => row.id)).toEqual(["owed-refunds:t1", "owed-refund:b3"]);
  });

  it("states no total when one seat has no amount, or the currencies differ", () => {
    // A money figure that is quietly short is the one thing this row may never
    // print: a missing amount is a real recorded state, not a zero.
    const missing = collapseOwedRefunds(
      [seat({ bookingId: "b1" }), seat({ bookingId: "b2", amountCents: null })],
      "blue-reef",
      "en-US",
    );
    expect(missing[0]?.detail).not.toContain("$");

    const mixed = collapseOwedRefunds(
      [seat({ bookingId: "b1" }), seat({ bookingId: "b2", currency: "eur" })],
      "blue-reef",
      "en-US",
    );
    expect(mixed[0]?.detail).not.toContain("$");
  });
});

describe("collapseEmailDeliveries", () => {
  const issue = (
    name: string,
    overrides: Partial<Parameters<typeof collapseEmailDeliveries>[0][number]> = {},
  ) => ({
    deliveryId: `d-${name}`,
    bookingId: `b-${name}`,
    personId: `p-${name}`,
    fullName: name,
    isWaiver: false,
    status: "failed" as const,
    trip: { id: "t1", startsAt: hoursFromNow(3), label: "Reef Drift · 8:00 AM" },
    ...overrides,
  });

  it("keeps one failed email named, with its own resend", () => {
    const [row, ...rest] = collapseEmailDeliveries([issue("Ana Ruiz")], "blue-reef", NOW);
    expect(rest).toHaveLength(0);
    expect(row?.subject).toBe("Ana Ruiz");
    expect(row?.detail).toBe("Confirmation email didn’t send.");
    expect(row?.actionLabel).toBe("Resend confirmation");
    expect(row?.resend).toEqual({ bookingIds: ["b-Ana Ruiz"] });
    expect(row?.href).toBe("/shop/blue-reef/divers/p-Ana Ruiz");
  });

  it("points a batch over two same-minute boats at the same one, whatever order they arrive in (issue #2176)", () => {
    const at = hoursFromNow(3);
    const pair = [
      issue("Ana", { trip: { id: "t2", startsAt: at, label: "Wreck Trek · 8:00 AM" } }),
      issue("Ben", { trip: { id: "t1", startsAt: at, label: "Reef Drift · 8:00 AM" } }),
    ];
    for (const order of [pair, [...pair].reverse()]) {
      const [row] = collapseEmailDeliveries(order, "blue-reef", NOW);
      expect(row?.href).toBe("/shop/blue-reef/trips/t1");
      expect(row?.resend).toEqual({ bookingIds: ["b-Ben", "b-Ana"] });
    }
  });

  it("batches failures for several people into one row that resends them all", () => {
    const rows = collapseEmailDeliveries(
      [issue("Ana"), issue("Ben"), issue("Cara")],
      "blue-reef",
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.subject).toBe("3 confirmation emails didn’t send.");
    expect(rows[0]?.detail).toBe("");
    expect(rows[0]?.actionLabel).toBe("Resend confirmations");
    expect(rows[0]?.resend).toEqual({ bookingIds: ["b-Ana", "b-Ben", "b-Cara"] });
    expect(rows[0]?.departure?.tripId).toBe("t1");
  });

  it("batches across boats, naming no single boat when there are several", () => {
    const rows = collapseEmailDeliveries(
      [
        issue("Ana"),
        issue("Ben", { trip: { id: "t2", startsAt: hoursFromNow(1), label: "Night Dive" } }),
      ],
      "blue-reef",
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.departure).toBeUndefined();
    // The earliest boat's roster is the fallback door.
    expect(rows[0]?.href).toBe("/shop/blue-reef/trips/t2");
    expect(rows[0]?.resend).toEqual({ bookingIds: ["b-Ben", "b-Ana"] });
  });

  it("keeps waiver links and confirmations, and bounces and an unset sender, apart", () => {
    const rows = collapseEmailDeliveries(
      [
        issue("Ana"),
        issue("Ben"),
        issue("Cara", { isWaiver: true }),
        issue("Dev", { isWaiver: true }),
        issue("Eli", { status: "not_configured" }),
      ],
      "blue-reef",
      NOW,
    );
    expect(rows.map((row) => row.subject)).toEqual([
      "2 confirmation emails didn’t send.",
      "2 waiver emails didn’t send.",
      "Eli",
    ]);
    expect(rows[1]?.waiver).toEqual({ bookingIds: ["b-Cara", "b-Dev"] });
    expect(rows[1]?.actionLabel).toBe("Resend waivers");
    expect(rows[2]?.detail).toBe("Confirmation email never sent. Email isn’t set up.");
  });
});

describe("crew_clash_sailed against the roll call (H-20260916-may-one-hull-carry, #1814)", () => {
  it("never leads a missing diver or a blocked diver aboard, even due earlier", () => {
    // Needs you ranks tone first: every after-dive roll-call row and a blocked
    // diver aboard are danger, the clash a warning, so no date lifts it over
    // them. Among warnings it leads the boarding-time blockers.
    const sorted = sortStationRows([
      action({ id: "nitrox", kind: "nitrox_gate", urgency: "imminent", dueAt: hoursFromNow(1) }),
      action({
        id: "clash",
        kind: "crew_clash_sailed",
        urgency: "imminent",
        dueAt: hoursFromNow(1),
      }),
      action({ id: "aboard", kind: "blocked_aboard", urgency: "imminent", dueAt: hoursFromNow(3) }),
      action({
        id: "missing",
        kind: "roll_call_missing_diver",
        urgency: "imminent",
        dueAt: hoursFromNow(4),
      }),
    ]);
    expect(sorted.map((row) => row.id)).toEqual(["aboard", "missing", "clash", "nitrox"]);
  });

  it("is a warning, like the clash before the boat sails", () => {
    expect(ACTION_KIND_META.crew_clash_sailed.tone).toBe("warning");
    expect(ACTION_KIND_META.crew_clash.tone).toBe("warning");
  });
});

describe("crewClashPhase", () => {
  const dayOne = { startsAt: hoursFromNow(-30), endsAt: hoursFromNow(-26) };
  const dayTwo = { startsAt: hoursFromNow(2), endsAt: hoursFromNow(6) };
  const phaseAt = (
    legs: { startsAt: Date; endsAt: Date }[],
    now: Date,
    departureRollCallRecorded = false,
  ) =>
    crewClashPhase({
      legs,
      departureStartsAt: legs[0]?.startsAt ?? now,
      departureRollCallRecorded,
      now,
    });

  it("is ahead while the clashing leg is still to sail, even when an earlier leg is home", () => {
    expect(phaseAt([dayOne, dayTwo], NOW)).toEqual({ phase: "ahead", leg: dayTwo });
  });

  it("turns out an hour after the leg's start, and silent once it is home", () => {
    const fromStart = (hours: number) => new Date(dayTwo.startsAt.getTime() + hours * 3_600_000);
    expect(phaseAt([dayTwo], fromStart(0.5))?.phase).toBe("ahead");
    expect(phaseAt([dayTwo], fromStart(1))?.phase).toBe("out");
    expect(phaseAt([dayTwo], fromStart(4.9))?.phase).toBe("out");
    expect(phaseAt([dayTwo], fromStart(5))).toBeNull();
  });

  it("takes the crew's departure roll call over the clock, for the first leg only", () => {
    const leg = { startsAt: hoursFromNow(-0.25), endsAt: hoursFromNow(3) };
    expect(phaseAt([leg], NOW, true)?.phase).toBe("out");
    expect(phaseAt([leg], NOW, false)?.phase).toBe("ahead");
    const later = { startsAt: hoursFromNow(-0.25), endsAt: hoursFromNow(3) };
    expect(
      crewClashPhase({
        legs: [later],
        departureStartsAt: hoursFromNow(-24),
        departureRollCallRecorded: true,
        now: NOW,
      })?.phase,
    ).toBe("ahead");
  });

  it("says nothing once every clashing leg is home", () => {
    expect(phaseAt([dayOne], NOW)).toBeNull();
  });
});

describe("assembleDaySpine and a boat that is out but no station", () => {
  it("files its rows at the desk, never into the week's count", () => {
    const spine = assembleDaySpine(
      {
        departures: [departure()],
        outTripIds: ["gone", "t1"],
        actions: [
          action({ id: "out", kind: "crew_clash_sailed", departure: boat("gone", "Wreck") }),
          action({ id: "station", departure: boat("t1") }),
          action({ id: "friday", departure: boat("t9") }),
        ],
      },
      { departures: [], actions: [] },
    );
    expect(spine.desk.map((row) => row.id)).toEqual(["out"]);
    expect(spine.desk[0]?.departure?.label).toBe("Wreck");
    // A boat still out and still a station keeps its row on the station.
    expect(spine.stations[0]?.rows.map((row) => row.id)).toEqual(["station"]);
    expect(spine.week.jobs).toBe(1);
  });
});

describe("the boat's emergency kit on Today (dive-domain review 2026-10-09)", () => {
  const kit = action({
    id: "boat-safety-kit:t1",
    kind: "boat_safety_kit",
    departure: { tripId: "t1", label: "Reef · 8:00 AM" },
    urgency: "now",
  });

  it("is danger, and every role on the boat sees it", () => {
    expect(ACTION_KIND_META.boat_safety_kit.tone).toBe("danger");
    for (const role of ["crew", "captain", "divemaster", "assistant_instructor"] as const) {
      expect(filterActionsForRoles([kit], [role])).toEqual([kit]);
    }
  });

  it("ranks above unanswered messages and reviews waiting", () => {
    const sorted = sortStationRows([
      action({ id: "reviews", kind: "reviews_pending", urgency: "now" }),
      action({ id: "messages", kind: "unanswered_messages", urgency: "now" }),
      kit,
    ]);
    expect(sorted.map((row) => row.id)[0]).toBe("boat-safety-kit:t1");
  });

  it("keeps the boat errands the owner's, a paper due quiet and expired kit a warning", () => {
    const due = action({ id: "papers", kind: "boat_papers_due", urgency: "later" });
    const lapsed = action({ id: "lapsed", kind: "boat_safety_expired" });
    expect(ACTION_KIND_META.boat_papers_due.tone).toBe("neutral");
    expect(ACTION_KIND_META.boat_safety_expired.tone).toBe("warning");
    expect(filterActionsForRoles([due, lapsed], ["crew"])).toEqual([]);
    expect(filterActionsForRoles([due, lapsed], ["manager"])).toHaveLength(2);
  });
});

describe("groupByDeparture", () => {
  it("says each boat once, keeps the rank inside it, and puts the desk last", () => {
    const rows = sortStationRows([
      action({ id: "messages", kind: "unanswered_messages", subject: "3", departure: undefined }),
      action({ id: "waiver-late", kind: "waiver", subject: "Ana", departure: boat("late") }),
      action({ id: "medical", kind: "medical_review", subject: "Bo", departure: boat("early") }),
      action({ id: "prep", kind: "dive_prep", subject: "4 sizes", departure: boat("early") }),
    ]);
    const groups = groupByDeparture(rows);
    expect(groups.map((group) => group.departure?.tripId ?? "desk")).toEqual([
      "early",
      "late",
      "desk",
    ]);
    expect(groups[0]?.rows.map((row) => row.id)).toEqual(["medical", "prep"]);
    expect(groups.flatMap((group) => group.rows)).toHaveLength(rows.length);
  });

  it("draws no desk group when every row is about a boat", () => {
    const groups = groupByDeparture([action({ id: "w", kind: "waiver", departure: boat("t1") })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.departure?.tripId).toBe("t1");
  });
});
