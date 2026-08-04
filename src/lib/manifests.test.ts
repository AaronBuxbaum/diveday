import { describe, expect, it } from "vitest";
import {
  buddyAlertFor,
  buildTripManifest,
  type CrewAttestation,
  carryForwardNotBoarded,
  crewRollCallCounts,
  isNotBackAboard,
  isRollCallAccountedFor,
  isRollCallCheckpoint,
  type ManifestBuddyTeam,
  type ManifestDiverInput,
  maxRecordedDiveNumber,
  type RollCallRecord,
  rollCallCheckpoints,
  rollCallCompleteness,
  rollCallLabel,
  splitBuddyTeamIds,
} from "./manifests";

const boardedAt = (recordedByName = "Dana Reyes"): RollCallRecord => ({
  state: "boarded",
  occurredAt: new Date("2026-07-20T11:45:00.000Z"),
  recordedByName,
  note: null,
});
const notBoardedAt = (note: string | null = null): RollCallRecord => ({
  state: "not_boarded",
  occurredAt: new Date("2026-07-20T11:45:00.000Z"),
  recordedByName: "Dana Reyes",
  note,
});

const trip = {
  id: "trip-1",
  title: "Two-Tank Reef",
  startsAt: new Date("2026-07-20T12:00:00.000Z"),
  endsAt: new Date("2026-07-20T16:00:00.000Z"),
  plannedDives: 2,
};

describe("buildTripManifest", () => {
  it("retains every supplied booking and fails closed when its readiness lookup is unavailable", () => {
    const manifest = buildTripManifest({
      trip,
      crew: [{ id: "crew-dana", fullName: "Dana Reyes", roles: ["captain"] }],
      divers: [
        {
          bookingId: "booking-ready",
          fullName: "Priya Sharma",
          email: "priya@example.com",
          emergencyContactName: "Asha Sharma",
          emergencyContactPhone: "+1-305-555-0101",
          readiness: { status: "ready", blockers: [] },
          rentalFit: {
            state: "rents" as const,
            items: [
              { kind: "bcd" as const, size: "M" },
              { kind: "wetsuit" as const, size: "5mm M" },
            ],
          },
          nitroxRequested: true,
          checkedIn: true,
          rollCall: {
            state: "boarded",
            occurredAt: new Date("2026-07-20T11:45:00.000Z"),
            recordedByName: "Dana Reyes",
            note: null,
          },
        },
        {
          bookingId: "booking-unknown",
          fullName: "Omar Haddad",
          email: null,
          emergencyContactName: null,
          emergencyContactPhone: null,
          rentalFit: { state: "not_recorded" as const },
          nitroxRequested: false,
          checkedIn: false,
        },
      ],
    });

    expect(manifest.divers).toHaveLength(2);
    expect(manifest.divers[1]?.readiness.blockers).toContainEqual(
      expect.objectContaining({ code: "readiness_unavailable" }),
    );
    expect(manifest.summary).toEqual({
      totalDivers: 2,
      ready: 1,
      blocked: 1,
      boarded: 1,
      notBoarded: 0,
      notBackAboard: 0,
      awaiting: 1,
      unaccountedFor: 1,
    });
    // Counter check-in and boat roll call are different questions (task 149):
    // a diver can be checked in at the counter without being boarded, or
    // vice versa on a walk-in who skipped the counter — the manifest carries
    // both independently rather than conflating them.
    expect(manifest.divers.find((d) => d.bookingId === "booking-ready")?.checkedIn).toBe(true);
    expect(manifest.divers.find((d) => d.bookingId === "booking-unknown")?.checkedIn).toBe(false);
  });

  /**
   * DOM-H3, at the level the manifest page actually reads. The summary is what
   * feeds the tiles, the progress line, and `completeness` — so the split has to
   * survive all the way through `buildTripManifest`, not just live in a
   * predicate nobody calls.
   */
  it("leaves an after-dive checkpoint incomplete when a diver has not come back", () => {
    const build = (checkpoint: "departure" | "after_dive_1") =>
      buildTripManifest({
        trip,
        checkpoint,
        // The captain has her own result too: since
        // 20260803-per-person-crew-roll-call the count alone no longer closes
        // the crew half, so this fixture states both halves and the assertion
        // below stays about the *divers*.
        crew: [{ id: "crew-1", fullName: "Dana Reyes", roles: ["captain"], rollCall: boardedAt() }],
        crewAttestation: {
          crewAboard: 1,
          crewAssigned: 1,
          attestedByName: "Dana Reyes",
          occurredAt: new Date("2026-07-20T13:45:00.000Z"),
          note: null,
        },
        divers: [
          {
            bookingId: "booking-aboard",
            fullName: "Priya Sharma",
            email: null,
            emergencyContactName: null,
            emergencyContactPhone: null,
            readiness: { status: "ready", blockers: [] },
            rentalFit: { state: "own_kit" as const },
            nitroxRequested: false,
            checkedIn: true,
            rollCall: boardedAt(),
          },
          {
            bookingId: "booking-missing",
            fullName: "Omar Haddad",
            email: null,
            emergencyContactName: null,
            emergencyContactPhone: null,
            readiness: { status: "ready", blockers: [] },
            rentalFit: { state: "own_kit" as const },
            nitroxRequested: false,
            checkedIn: true,
            rollCall: notBoardedAt("Not on the ladder"),
          },
        ],
      });

    // After a dive the same record means "did not return to the boat": every
    // diver has a result, so `awaiting` is 0 — and the checkpoint is still open.
    const afterDive = build("after_dive_1");
    expect(afterDive.summary.awaiting).toBe(0);
    expect(afterDive.summary.notBackAboard).toBe(1);
    expect(afterDive.summary.unaccountedFor).toBe(1);
    expect(afterDive.completeness).toMatchObject({
      complete: false,
      diversAccountedFor: false,
      crewAccountedFor: true,
      reason: "divers_not_back_aboard",
    });

    // At the dock the identical record means "never left", which is a diver
    // accounted for — that half of the behaviour is unchanged.
    const departure = build("departure");
    expect(departure.summary.notBackAboard).toBe(0);
    expect(departure.summary.unaccountedFor).toBe(0);
    expect(departure.completeness).toMatchObject({ complete: true, reason: null });
  });

  it("returns a code for every roll-call state, and the after-dive one is its own state", () => {
    // Codes, never sentences: `src/lib` hands back the state and the staff
    // bundle picks the words (`rollCallLabelText`, src/i18n/manifest-labels.ts).
    expect(rollCallLabel("departure", undefined)).toBe("awaiting");
    expect(rollCallLabel("departure", notBoardedAt("Stayed ashore"))).toBe("not_boarded");
    expect(rollCallLabel("departure", boardedAt())).toBe("boarded");
    expect(rollCallLabel("after_dive_1", { ...notBoardedAt(), implied: true })).toBe(
      "not_boarded_carried",
    );
    // The one that used to render as "Not boarded" (and, on the button beside
    // it, "Not boarded ✓") for a diver who had not come back from dive one.
    expect(rollCallLabel("after_dive_1", notBoardedAt("Not on the ladder"))).toBe(
      "not_back_aboard",
    );
    expect(rollCallLabel("after_dive_2", boardedAt())).toBe("boarded");
  });

  it("carries a departure not-boarded forward until a later result breaks the chain", () => {
    // Not boarded at departure → every later checkpoint defaults to not boarded.
    const carried = carryForwardNotBoarded([
      notBoardedAt("Never left the dock"),
      undefined,
      undefined,
    ]);
    expect(carried[0]).toMatchObject({ state: "not_boarded", note: "Never left the dock" });
    expect(carried[0]?.implied).toBeUndefined();
    expect(carried[1]).toMatchObject({ state: "not_boarded", implied: true });
    expect(carried[2]).toMatchObject({ state: "not_boarded", implied: true });
  });

  /**
   * DOM-H3, the defect this whole file exists to stop coming back. A
   * `not_boarded` recorded *after a dive* is the missing-diver event — "did not
   * return to the boat" — and carrying it forward as an accounted-for record is
   * what let a later checkpoint close on a diver still in the water.
   */
  it("never carries an after-dive not-boarded forward — a missing diver cannot satisfy a later count", () => {
    const carried = carryForwardNotBoarded([
      boardedAt(),
      notBoardedAt("Not on the ladder"),
      undefined,
      undefined,
    ]);
    expect(carried[1]).toMatchObject({ state: "not_boarded", note: "Not on the ladder" });
    // Dives two and three must ask again rather than inheriting an answer.
    expect(carried[2]).toBeUndefined();
    expect(carried[3]).toBeUndefined();
  });

  it("does not carry a boarded result forward, and an explicit later result wins", () => {
    // Boarded is checkpoint-specific: the next list starts awaiting again.
    expect(carryForwardNotBoarded([boardedAt(), undefined])).toEqual([boardedAt(), undefined]);
    // A re-board after leaving stops the carry-forward from that point.
    const reboarded = carryForwardNotBoarded([notBoardedAt(), boardedAt(), undefined]);
    expect(reboarded[1]).toMatchObject({ state: "boarded" });
    expect(reboarded[2]).toBeUndefined();
    // An explicit result at a later checkpoint is never overwritten by the default.
    const explicitLater = carryForwardNotBoarded([notBoardedAt(), notBoardedAt("Own decision")]);
    expect(explicitLater[1]).toMatchObject({ note: "Own decision" });
    expect(explicitLater[1]?.implied).toBeUndefined();
  });

  it("splits the two meanings of not_boarded by checkpoint, once, for every reader", () => {
    // Departure: never left the dock. Benign, and accounted for.
    expect(isNotBackAboard("departure", notBoardedAt())).toBe(false);
    expect(isRollCallAccountedFor("departure", notBoardedAt())).toBe(true);
    // After a dive: did not return to the boat.
    expect(isNotBackAboard("after_dive_1", notBoardedAt())).toBe(true);
    expect(isRollCallAccountedFor("after_dive_1", notBoardedAt())).toBe(false);
    // ...unless it was carried forward from the dock, where it still means
    // "never left" and the diver is still accounted for.
    expect(isNotBackAboard("after_dive_1", { ...notBoardedAt(), implied: true })).toBe(false);
    expect(isRollCallAccountedFor("after_dive_1", { ...notBoardedAt(), implied: true })).toBe(true);
    // Boarded is accounted for anywhere; no result at all never is.
    expect(isRollCallAccountedFor("after_dive_1", boardedAt())).toBe(true);
    expect(isRollCallAccountedFor("departure", undefined)).toBe(false);
  });

  it("builds bounded departure and after-dive checkpoints", () => {
    expect(rollCallCheckpoints(2)).toEqual(["departure", "after_dive_1", "after_dive_2"]);
    expect(isRollCallCheckpoint("after_dive_2", 2)).toBe(true);
    expect(isRollCallCheckpoint("after_dive_3", 2)).toBe(false);
    // A checkpoint's word ("Before departure" / "After dive N") is resolved
    // against a message bundle by the caller — see
    // src/i18n/manifest-labels.test.ts's `rollCallCheckpointText` coverage —
    // `RollCallCheckpoint` itself is already the code.
  });

  it("finds the highest recorded dive number, or 0 with no after-dive history", () => {
    const t0 = new Date("2026-06-01T10:00:00Z");
    const boarded = (bookingId: string, checkpoint: string, occurredAt = t0) => ({
      bookingId,
      checkpoint,
      status: "boarded",
      occurredAt,
      createdAt: occurredAt,
    });

    expect(maxRecordedDiveNumber([])).toBe(0);
    expect(maxRecordedDiveNumber([boarded("b1", "departure")])).toBe(0);
    expect(maxRecordedDiveNumber([boarded("b1", "departure"), boarded("b1", "after_dive_1")])).toBe(
      1,
    );
    expect(
      maxRecordedDiveNumber([
        boarded("b1", "after_dive_1"),
        boarded("b2", "after_dive_3"),
        boarded("b1", "after_dive_2"),
      ]),
    ).toBe(3);
    expect(
      maxRecordedDiveNumber([boarded("b1", "not-a-checkpoint"), boarded("b1", "after_dive_4")]),
    ).toBe(4);
  });

  it("ignores a checkpoint whose latest event for that diver is a clear — the mis-tap-then-undo case (dive-domain-expert review finding, CR-006)", () => {
    const t0 = new Date("2026-06-01T10:00:00Z");
    const t1 = new Date("2026-06-01T10:05:00Z");

    // b1 was mis-tapped at after_dive_3, then immediately cleared — no diver
    // was ever actually counted there, so it must not block a plannedDives
    // edit down to 2.
    expect(
      maxRecordedDiveNumber([
        {
          bookingId: "b1",
          checkpoint: "after_dive_3",
          status: "boarded",
          occurredAt: t0,
          createdAt: t0,
        },
        {
          bookingId: "b1",
          checkpoint: "after_dive_3",
          status: "cleared",
          occurredAt: t1,
          createdAt: t1,
        },
        {
          bookingId: "b1",
          checkpoint: "after_dive_2",
          status: "boarded",
          occurredAt: t0,
          createdAt: t0,
        },
      ]),
    ).toBe(2);

    // But a second diver genuinely boarded at after_dive_3 (never cleared)
    // means dive 3 really did happen — the checkpoint counts.
    expect(
      maxRecordedDiveNumber([
        {
          bookingId: "b1",
          checkpoint: "after_dive_3",
          status: "boarded",
          occurredAt: t0,
          createdAt: t0,
        },
        {
          bookingId: "b1",
          checkpoint: "after_dive_3",
          status: "cleared",
          occurredAt: t1,
          createdAt: t1,
        },
        {
          bookingId: "b2",
          checkpoint: "after_dive_3",
          status: "boarded",
          occurredAt: t0,
          createdAt: t0,
        },
      ]),
    ).toBe(3);
  });
});

/**
 * DOM-H1. Crew are the people most reliably in the water and were not part of
 * the head count at all — a checkpoint with every booked diver counted read
 * "roll call complete" with a divemaster still down. These are the rules that
 * stop it, and this is the *only* definition of complete: both the live
 * manifest and the offline copy consume this one function.
 */
describe("rollCallCompleteness — the crew half of the head count (DOM-H1)", () => {
  const attested = (crewAboard: number, crewAssigned = crewAboard): CrewAttestation => ({
    crewAboard,
    crewAssigned,
    attestedByName: "Dana Reyes",
    occurredAt: new Date("2026-07-20T11:45:00.000Z"),
    note: null,
  });

  /**
   * A crew list of `assigned` people, built from the outcomes the checkpoint
   * cares about. `rollCallCompleteness` takes the **list**, never counts: the
   * crew fields used to be optional numbers defaulting to 0, so a caller who
   * supplied the attestation and forgot the per-person figures got
   * `complete: true` with nobody named and the compiler said nothing (D7).
   */
  const crewOf = ({
    assigned,
    awaiting = 0,
    notBackAboard = 0,
    ashore = 0,
  }: {
    assigned: number;
    awaiting?: number;
    notBackAboard?: number;
    ashore?: number;
  }) =>
    Array.from({ length: assigned }, (_, index) => {
      if (index < awaiting) return {};
      if (index < awaiting + notBackAboard) return { rollCall: notBoardedAt() };
      if (index < awaiting + notBackAboard + ashore) {
        return { rollCall: { ...notBoardedAt(), implied: true } };
      }
      return { rollCall: boardedAt() };
    });
  /** Everyone assigned is aboard — the ordinary case the crew rules ride on. */
  const allAboard = (assigned: number) => crewOf({ assigned });

  it("does not read complete when every diver is counted but no crew attestation exists", () => {
    // The bug, stated as a test: divers all done, checkpoint still open.
    expect(
      rollCallCompleteness({
        checkpoint: "departure",
        totalDivers: 6,
        awaiting: 0,
        notBackAboard: 0,
        crew: allAboard(2),
        crewAttestation: null,
      }),
    ).toMatchObject({
      complete: false,
      diversAccountedFor: true,
      crewAccountedFor: false,
      reason: "crew_not_attested",
      crewReason: "crew_not_attested",
    });
  });

  it("does not read complete when fewer crew are attested aboard than are assigned", () => {
    expect(
      rollCallCompleteness({
        checkpoint: "departure",
        totalDivers: 6,
        awaiting: 0,
        notBackAboard: 0,
        crew: allAboard(3),
        crewAttestation: attested(2, 3),
      }),
    ).toMatchObject({ complete: false, crewAccountedFor: false, reason: "crew_short" });
  });

  it("reads complete only once divers and crew are both accounted for", () => {
    expect(
      rollCallCompleteness({
        checkpoint: "departure",
        totalDivers: 6,
        awaiting: 0,
        notBackAboard: 0,
        crew: allAboard(2),
        crewAttestation: attested(2),
      }),
    ).toMatchObject({
      complete: true,
      diversAccountedFor: true,
      crewAccountedFor: true,
      reason: null,
      crewReason: null,
    });
  });

  it("keeps the diver rules first: an awaiting diver outranks any crew count", () => {
    expect(
      rollCallCompleteness({
        checkpoint: "departure",
        totalDivers: 6,
        awaiting: 1,
        notBackAboard: 0,
        crew: allAboard(2),
        crewAttestation: attested(2),
      }),
    ).toMatchObject({ complete: false, diversAccountedFor: false, reason: "divers_awaiting" });
    // An empty roster never read complete before this change either.
    expect(
      rollCallCompleteness({
        checkpoint: "departure",
        totalDivers: 0,
        awaiting: 0,
        notBackAboard: 0,
        crew: allAboard(2),
        crewAttestation: null,
      }),
    ).toMatchObject({ complete: false, reason: "no_divers" });
  });

  /**
   * The crew panel on both manifests reads `crewReason`, never `reason`. With a
   * diver still awaiting, `reason` is `divers_awaiting`, and a panel keyed off
   * it would quietly show "nobody has attested" on a boat where a named crew
   * member has been recorded as not back aboard.
   */
  it("states the crew half's own reason even while a diver reason ranks above it", () => {
    expect(
      rollCallCompleteness({
        checkpoint: "after_dive_1",
        totalDivers: 6,
        awaiting: 1,
        notBackAboard: 0,
        crew: crewOf({ assigned: 2, notBackAboard: 1 }),
        crewAttestation: attested(2),
      }),
    ).toMatchObject({ reason: "divers_awaiting", crewReason: "crew_not_back_aboard" });
  });

  it("treats a trip with zero assigned crew as still needing a human to say \u201c0 of 0\u201d", () => {
    // The tempting shortcut — "no crew assigned, so nothing to count" — would
    // hand back a silent pass on exactly the trips whose crew data is worst,
    // since an empty assignment list is a scheduling gap rather than evidence
    // that nobody else was aboard.
    expect(
      rollCallCompleteness({
        checkpoint: "departure",
        totalDivers: 4,
        awaiting: 0,
        notBackAboard: 0,
        crew: [],
        crewAttestation: null,
      }),
    ).toMatchObject({ complete: false, crewAccountedFor: false, reason: "crew_not_attested" });
    // Said out loud by a named human, it closes.
    expect(
      rollCallCompleteness({
        checkpoint: "departure",
        totalDivers: 4,
        awaiting: 0,
        notBackAboard: 0,
        crew: [],
        crewAttestation: attested(0),
      }),
    ).toMatchObject({ complete: true, crewAccountedFor: true, reason: null });
  });

  it("compares against the crew assigned now, not the denominator stored on the attestation", () => {
    // A divemaster added after the count was taken re-opens the checkpoint
    // rather than riding on a stale "2 of 2".
    expect(
      rollCallCompleteness({
        checkpoint: "departure",
        totalDivers: 4,
        awaiting: 0,
        notBackAboard: 0,
        crew: allAboard(3),
        crewAttestation: attested(2, 2),
      }),
    ).toMatchObject({ complete: false, reason: "crew_short" });
  });

  it("accepts more crew aboard than assigned — an extra hand is accounted for, not missing", () => {
    expect(
      rollCallCompleteness({
        checkpoint: "departure",
        totalDivers: 4,
        awaiting: 0,
        notBackAboard: 0,
        crew: allAboard(2),
        crewAttestation: attested(3, 2),
      }),
    ).toMatchObject({ complete: true, reason: null });
  });

  /**
   * Review 20260803, D2. Three crew rostered, Ana calls in sick. The crew mark
   * her `not_boarded` at departure — the correct thing, and it carries forward
   * — and attest "2 aboard", which is the true number of bodies on the boat.
   * Measuring the count against `crew.length` read `crew_short` at every
   * checkpoint of that trip, forever, and the only exits were typing `3` (a
   * false statement on a legal document) or deleting Ana from the crew, which
   * erases her roll-call history. A crew that cannot close an honest count
   * learns within two trips to type whatever number closes the box.
   */
  it("counts against the crew still expected aboard, not everyone rostered", () => {
    const ashoreAtDeparture = rollCallCompleteness({
      checkpoint: "departure",
      totalDivers: 4,
      awaiting: 0,
      notBackAboard: 0,
      crew: crewOf({ assigned: 3, ashore: 1 }),
      crewAttestation: attested(2, 3),
    });
    expect(ashoreAtDeparture.crewCounts).toMatchObject({
      crewAshore: 1,
      crewExpectedAboard: 2,
      crewAwaiting: 0,
    });
    expect(ashoreAtDeparture).toMatchObject({
      complete: true,
      crewAccountedFor: true,
      reason: null,
    });
    // And it stays closed at every later checkpoint, where her dock result is
    // carried forward rather than recorded again.
    expect(
      rollCallCompleteness({
        checkpoint: "after_dive_1",
        totalDivers: 4,
        awaiting: 0,
        notBackAboard: 0,
        crew: crewOf({ assigned: 3, ashore: 1 }),
        crewAttestation: attested(2, 3),
      }),
    ).toMatchObject({ complete: true, reason: null });
    // Two ashore, one aboard, and a count of 2 is now one body too many to be
    // short — but one *fewer* than expected still reads short.
    expect(
      rollCallCompleteness({
        checkpoint: "departure",
        totalDivers: 4,
        awaiting: 0,
        notBackAboard: 0,
        crew: crewOf({ assigned: 3, ashore: 1 }),
        crewAttestation: attested(1, 3),
      }),
    ).toMatchObject({ complete: false, reason: "crew_short" });
  });

  it("still makes somebody say the number when the whole crew is ashore", () => {
    // The expected count falls to zero, which is not the same as nothing to
    // say: "0 aboard" is still a sentence a named human has to state.
    const crew = crewOf({ assigned: 2, ashore: 2 });
    expect(
      rollCallCompleteness({
        checkpoint: "departure",
        totalDivers: 4,
        awaiting: 0,
        notBackAboard: 0,
        crew,
        crewAttestation: null,
      }),
    ).toMatchObject({ complete: false, reason: "crew_not_attested" });
    expect(
      rollCallCompleteness({
        checkpoint: "departure",
        totalDivers: 4,
        awaiting: 0,
        notBackAboard: 0,
        crew,
        crewAttestation: attested(0, 2),
      }),
    ).toMatchObject({ complete: true, reason: null });
  });

  it("never lets an after-dive “did not come back” shrink the expected count", () => {
    // The one `not_boarded` that must *not* reconcile: after a dive it means
    // "did not return to the boat", so the person is still expected aboard and
    // the checkpoint stays open however the count reads.
    const counts = crewRollCallCounts("after_dive_1", crewOf({ assigned: 3, notBackAboard: 1 }));
    expect(counts).toMatchObject({ crewAshore: 0, crewExpectedAboard: 3, crewNotBackAboard: 1 });
    expect(
      rollCallCompleteness({
        checkpoint: "after_dive_1",
        totalDivers: 4,
        awaiting: 0,
        notBackAboard: 0,
        crew: crewOf({ assigned: 3, notBackAboard: 1 }),
        crewAttestation: attested(3, 3),
      }),
    ).toMatchObject({ complete: false, reason: "crew_not_back_aboard" });
  });

  /**
   * DOM-H1, the per-person half (ADR 20260803-per-person-crew-roll-call). A
   * count says how many; it names nobody. "3 of 3 aboard" cannot tell the boat
   * that the third body is the deckhand rather than the divemaster who has not
   * surfaced — so a checkpoint also needs every crew member the trip *names* to
   * have a result of their own. Both halves stay: the events cover the named
   * crew, the count covers anyone the assignment list never named.
   */
  it("keeps the checkpoint open when a named crew member has no result of their own", () => {
    expect(
      rollCallCompleteness({
        checkpoint: "departure",
        totalDivers: 4,
        awaiting: 0,
        notBackAboard: 0,
        crew: crewOf({ assigned: 3, awaiting: 1 }),
        crewAttestation: attested(3),
      }),
    ).toMatchObject({ complete: false, crewAccountedFor: false, reason: "crew_awaiting" });
  });

  it("makes a crew member recorded as not back aboard the loudest reason on the boat", () => {
    // Ranked above every other crew reason: a human has stated that somebody
    // who was in the water has not come back. The count being satisfied, or
    // never taken, does not soften that.
    expect(
      rollCallCompleteness({
        checkpoint: "after_dive_1",
        totalDivers: 4,
        awaiting: 0,
        notBackAboard: 0,
        crew: crewOf({ assigned: 2, notBackAboard: 1 }),
        crewAttestation: attested(2),
      }),
    ).toMatchObject({ complete: false, crewAccountedFor: false, reason: "crew_not_back_aboard" });
    expect(
      rollCallCompleteness({
        checkpoint: "after_dive_1",
        totalDivers: 4,
        awaiting: 0,
        notBackAboard: 0,
        crew: crewOf({ assigned: 2, awaiting: 1, notBackAboard: 1 }),
        crewAttestation: null,
      }),
    ).toMatchObject({ complete: false, reason: "crew_not_back_aboard" });
    // But a diver still in the water outranks it — divers stay first, which is
    // the ordering the surfaces above have always relied on.
    expect(
      rollCallCompleteness({
        checkpoint: "after_dive_1",
        totalDivers: 4,
        awaiting: 0,
        notBackAboard: 1,
        crew: crewOf({ assigned: 2, notBackAboard: 1 }),
        crewAttestation: attested(2),
      }),
    ).toMatchObject({ reason: "divers_not_back_aboard", crewReason: "crew_not_back_aboard" });
  });

  it("names a short count before an untapped button, and closes only when both halves agree", () => {
    // A human who counted and came up short has *stated* an absence; an
    // untapped button is a clerical gap. Same ranking as
    // `divers_not_back_aboard` over `divers_awaiting`.
    expect(
      rollCallCompleteness({
        checkpoint: "departure",
        totalDivers: 4,
        awaiting: 0,
        notBackAboard: 0,
        crew: crewOf({ assigned: 3, awaiting: 1 }),
        crewAttestation: attested(2, 3),
      }),
    ).toMatchObject({ complete: false, reason: "crew_short" });
    // Count taken, every named crew member accounted for: closed.
    expect(
      rollCallCompleteness({
        checkpoint: "departure",
        totalDivers: 4,
        awaiting: 0,
        notBackAboard: 0,
        crew: allAboard(3),
        crewAttestation: attested(3),
      }),
    ).toMatchObject({ complete: true, crewAccountedFor: true, reason: null });
  });

  it("still needs the count on a trip with named crew who are all accounted for", () => {
    // Per-person results are stronger evidence about the *named* crew, and
    // weaker about everyone else — a deckhand nobody rostered has no row to
    // account for. The count is what covers them, so it is not optional.
    expect(
      rollCallCompleteness({
        checkpoint: "departure",
        totalDivers: 4,
        awaiting: 0,
        notBackAboard: 0,
        crew: allAboard(2),
        crewAttestation: null,
      }),
    ).toMatchObject({ complete: false, reason: "crew_not_attested" });
  });

  /**
   * DOM-H3. `awaiting` counts divers with *no result*, so before this a diver a
   * human had recorded as not back aboard read as accounted for and the whole
   * checkpoint closed. There is still exactly one closing rule —
   * `unaccountedFor === 0` — and the awaiting/not-back-aboard split only picks
   * which reason to name.
   */
  it("does not let a diver recorded as not back aboard close the checkpoint", () => {
    expect(
      rollCallCompleteness({
        checkpoint: "after_dive_1",
        totalDivers: 6,
        awaiting: 0,
        notBackAboard: 1,
        crew: allAboard(2),
        crewAttestation: attested(2),
      }),
    ).toMatchObject({
      complete: false,
      diversAccountedFor: false,
      crewAccountedFor: true,
      reason: "divers_not_back_aboard",
    });
  });

  it("names the missing diver ahead of a clerical gap on the same boat", () => {
    // Same precedence `listRollCallGaps` uses (`missing_diver` outranks
    // `after_dive_uncounted`): a stated "they didn't come back" is not allowed
    // to hide behind "three still to call".
    expect(
      rollCallCompleteness({
        checkpoint: "after_dive_1",
        totalDivers: 6,
        awaiting: 3,
        notBackAboard: 1,
        crew: [],
        crewAttestation: null,
      }),
    ).toMatchObject({ complete: false, reason: "divers_not_back_aboard" });
  });

  it("is the definition buildTripManifest derives, so no surface can invent its own", () => {
    const withCrew = (crewAttestation: CrewAttestation | null) =>
      buildTripManifest({
        trip,
        crew: [{ id: "crew-1", fullName: "Dana Reyes", roles: ["captain"], rollCall: boardedAt() }],
        crewAttestation,
        divers: [
          {
            bookingId: "booking-1",
            fullName: "Priya Sharma",
            email: null,
            emergencyContactName: null,
            emergencyContactPhone: null,
            readiness: { status: "ready", blockers: [] },
            rentalFit: { state: "own_kit" as const },
            nitroxRequested: false,
            checkedIn: true,
            rollCall: boardedAt(),
          },
        ],
      });

    // Every diver boarded — the old inline rule (`totalDivers > 0 && awaiting
    // === 0`, written twice at the UI layer) called this complete.
    const unattested = withCrew(null);
    expect(unattested.summary.awaiting).toBe(0);
    expect(unattested.completeness).toMatchObject({
      complete: false,
      reason: "crew_not_attested",
    });
    expect(withCrew(attested(1)).completeness.complete).toBe(true);
  });

  /**
   * `buildTripManifest` derives the crew half from the crew list itself, so a
   * caller cannot hand it a count that disagrees with the people on the list.
   */
  it("derives the crew counts from the crew list, not from a caller-supplied number", () => {
    const build = (crewRollCall: RollCallRecord | undefined, checkpoint?: "after_dive_1") =>
      buildTripManifest({
        trip,
        checkpoint,
        crew: [
          { id: "crew-1", fullName: "Dana Reyes", roles: ["captain"], rollCall: boardedAt() },
          { id: "crew-2", fullName: "Ana Vidal", roles: ["divemaster"], rollCall: crewRollCall },
        ],
        crewAttestation: attested(2),
        divers: [
          {
            bookingId: "booking-1",
            fullName: "Priya Sharma",
            email: null,
            emergencyContactName: null,
            emergencyContactPhone: null,
            readiness: { status: "ready", blockers: [] },
            rentalFit: { state: "own_kit" as const },
            nitroxRequested: false,
            checkedIn: true,
            rollCall: boardedAt(),
          },
        ],
      });

    // The divemaster nobody has tapped keeps it open, even with "2 of 2" said.
    expect(build(undefined).completeness).toMatchObject({
      complete: false,
      reason: "crew_awaiting",
    });
    expect(build(boardedAt()).completeness).toMatchObject({ complete: true, reason: null });
    // And after a dive, "not boarded" against her means she has not come back.
    expect(build(notBoardedAt(), "after_dive_1").completeness).toMatchObject({
      complete: false,
      reason: "crew_not_back_aboard",
    });
  });
});

describe("buddy teams — the split-team alert (ADR 20260804-buddy-teams)", () => {
  const carriedAshore: RollCallRecord = { ...notBoardedAt(), implied: true };

  it("says nothing unless this person is themselves back aboard", () => {
    // The alert renders on whoever is back — a teammate's own row already
    // carries whatever state matters about *them*.
    expect(buddyAlertFor("after_dive_1", undefined, [boardedAt()])).toBeNull();
    expect(buddyAlertFor("after_dive_1", notBoardedAt(), [undefined])).toBeNull();
    expect(buddyAlertFor("after_dive_1", carriedAshore, [undefined])).toBeNull();
  });

  it("is quiet when the team's statuses agree, and when there is no team at all", () => {
    expect(buddyAlertFor("departure", boardedAt(), [boardedAt()])).toBeNull();
    expect(buddyAlertFor("after_dive_1", boardedAt(), [boardedAt(), boardedAt()])).toBeNull();
    expect(buddyAlertFor("departure", undefined, [undefined])).toBeNull();
    // An empty teammate list is nobody to diverge from — never an alert.
    expect(buddyAlertFor("after_dive_1", boardedAt(), [])).toBeNull();
  });

  it("raises the dock heads-up while one is aboard and another is not yet", () => {
    expect(buddyAlertFor("departure", boardedAt(), [undefined])).toBe("separated_dock");
    expect(buddyAlertFor("departure", boardedAt(), [notBoardedAt()])).toBe("separated_dock");
  });

  it("raises the loud alert after a dive for an awaiting or not-back teammate", () => {
    expect(buddyAlertFor("after_dive_1", boardedAt(), [undefined])).toBe("separated_after_dive");
    expect(buddyAlertFor("after_dive_1", boardedAt(), [notBoardedAt()])).toBe(
      "separated_after_dive",
    );
  });

  it("needs only one unaccounted-for teammate, however large the team", () => {
    // Three of four back is exactly as loud as one of two: the boat's next
    // move is identical, and a team is not a severity scale.
    expect(buddyAlertFor("after_dive_1", boardedAt(), [boardedAt(), boardedAt(), undefined])).toBe(
      "separated_after_dive",
    );
    expect(
      buddyAlertFor("after_dive_1", boardedAt(), [boardedAt(), boardedAt(), boardedAt()]),
    ).toBeNull();
  });

  it("never alarms about a teammate who stayed ashore from the dock", () => {
    // Carried forward from departure: they never left. Accounted for on land,
    // not missing from the water — alarming here would teach the crew to stop
    // reading the panel.
    expect(buddyAlertFor("after_dive_1", boardedAt(), [carriedAshore])).toBeNull();
    // …but a second teammate with no result is still loud, so the exemption
    // can never silence a real one.
    expect(buddyAlertFor("after_dive_1", boardedAt(), [carriedAshore, undefined])).toBe(
      "separated_after_dive",
    );
  });

  const diver = (
    bookingId: string,
    fullName: string,
    extra: Partial<ManifestDiverInput> = {},
  ): ManifestDiverInput => ({
    bookingId,
    fullName,
    email: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    readiness: { status: "ready", blockers: [] },
    rentalFit: { state: "own_kit" as const },
    nitroxRequested: false,
    checkedIn: false,
    ...extra,
  });

  const team = (teamId: string, others: ManifestBuddyTeam["others"]) => ({ teamId, others });
  const otherDiver = (bookingId: string, fullName: string) =>
    ({ kind: "diver", bookingId, fullName }) as const;
  const otherCrew = (personId: string, fullName: string) =>
    ({ kind: "crew", personId, fullName }) as const;

  it("derives the alert through buildTripManifest, on the returned row only", () => {
    const manifest = buildTripManifest({
      trip,
      checkpoint: "after_dive_1",
      crew: [],
      divers: [
        diver("booking-tom", "Tom Okafor", {
          rollCall: boardedAt(),
          buddyTeam: team("team-1", [otherDiver("booking-lena", "Lena Fischer")]),
        }),
        diver("booking-lena", "Lena Fischer", {
          buddyTeam: team("team-1", [otherDiver("booking-tom", "Tom Okafor")]),
        }),
        // The odd diver out — unteamed, and that is normal, never an error.
        diver("booking-omar", "Omar Haddad"),
      ],
    });
    expect(manifest.divers.find((d) => d.bookingId === "booking-tom")?.buddyAlert).toBe(
      "separated_after_dive",
    );
    expect(manifest.divers.find((d) => d.bookingId === "booking-lena")?.buddyAlert).toBeNull();
    expect(manifest.divers.find((d) => d.bookingId === "booking-omar")?.buddyAlert).toBeNull();
  });

  it("reads a crew teammate's own roll call, and puts the alert on the crew row too", () => {
    const manifest = buildTripManifest({
      trip,
      checkpoint: "after_dive_1",
      crew: [
        {
          id: "person-keiko",
          fullName: "Keiko Tanaka",
          roles: ["divemaster"],
          rollCall: boardedAt(),
          buddyTeams: [team("team-1", [otherDiver("booking-tom", "Tom Okafor")])],
        },
      ],
      divers: [
        diver("booking-tom", "Tom Okafor", {
          buddyTeam: team("team-1", [otherCrew("person-keiko", "Keiko Tanaka")]),
        }),
      ],
    });
    // The divemaster is back and the diver they led is not — the split reads
    // on the DM's row, which is the row a deck is looking at.
    expect(manifest.crew[0]?.buddyAlert).toBe("separated_after_dive");
    expect(manifest.divers[0]?.buddyAlert).toBeNull();
  });

  it("counts split *teams*, not rows wearing an alert", () => {
    const manifest = buildTripManifest({
      trip,
      checkpoint: "after_dive_1",
      crew: [],
      divers: [
        diver("a", "A", {
          rollCall: boardedAt(),
          buddyTeam: team("team-1", [otherDiver("b", "B"), otherDiver("c", "C")]),
        }),
        diver("b", "B", {
          rollCall: boardedAt(),
          buddyTeam: team("team-1", [otherDiver("a", "A"), otherDiver("c", "C")]),
        }),
        diver("c", "C", {
          buddyTeam: team("team-1", [otherDiver("a", "A"), otherDiver("b", "B")]),
        }),
      ],
    });
    // Two rows wear the alert; one team is split.
    expect(manifest.divers.filter((d) => d.buddyAlert !== null)).toHaveLength(2);
    expect(splitBuddyTeamIds(manifest, "separated_after_dive")).toEqual(new Set(["team-1"]));
  });

  it("yields no alert for a teammate reference that is not on the manifest", () => {
    // Defensive: a stale reference (roster changed between reads) must not
    // fabricate an alert about a person who is not on the boat.
    const manifest = buildTripManifest({
      trip,
      checkpoint: "after_dive_1",
      crew: [],
      divers: [
        diver("booking-tom", "Tom Okafor", {
          rollCall: boardedAt(),
          buddyTeam: team("team-1", [otherDiver("booking-gone", "Gone Diver")]),
        }),
      ],
    });
    expect(manifest.divers[0]?.buddyAlert).toBeNull();
  });

  it("never lets a team change the checkpoint verdict", () => {
    const base = {
      trip,
      checkpoint: "after_dive_1" as const,
      crew: [],
      divers: [
        diver("booking-tom", "Tom Okafor", { rollCall: boardedAt() }),
        diver("booking-lena", "Lena Fischer"),
      ],
    };
    const unteamed = buildTripManifest(base);
    const teamed = buildTripManifest({
      ...base,
      divers: [
        diver("booking-tom", "Tom Okafor", {
          rollCall: boardedAt(),
          buddyTeam: team("team-1", [otherDiver("booking-lena", "Lena Fischer")]),
        }),
        diver("booking-lena", "Lena Fischer", {
          buddyTeam: team("team-1", [otherDiver("booking-tom", "Tom Okafor")]),
        }),
      ],
    });
    expect(teamed.completeness).toEqual(unteamed.completeness);
    expect(teamed.summary).toEqual(unteamed.summary);
  });
});
