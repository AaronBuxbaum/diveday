import { describe, expect, it } from "vitest";
import { canRecordOfflineCrewStatus, type OfflineRollCallEvent } from "@/lib/offline-manifests";
import { identifySavedRollCall } from "@/test/identified-offline-roll-call";
import { diver, savedCopy, view } from "./section-fixtures";
import { offlineTripView } from "./trip-view";
import { richEnvelope } from "./view-fixtures";

const TEST_MEETING_PROOF = `33333333-3333-4333-8333-333333333333.0.a.b.0.${"a".repeat(43)}`;
function withMeetingProof(copy: ReturnType<typeof savedCopy>) {
  const trip = copy.snapshot.manifests[0].trip;
  copy.snapshot.rollCallMeetingDays = [
    { startsAt: trip.startsAt, endsAt: trip.endsAt, meetingIdentityProof: TEST_MEETING_PROOF },
  ];
  return copy;
}

describe("offlineTripView", () => {
  it("keeps diver and crew awaiting after an unconfirmed dock absence", () => {
    const copy = savedCopy();
    const departure = copy.snapshot.manifests[0];
    copy.snapshot.manifests.push({ ...structuredClone(departure), checkpoint: "after_dive_1" });
    const proof = `33333333-3333-4333-8333-333333333333.0.a.b.0.${"a".repeat(43)}`;
    copy.snapshot.rollCallMeetingDays = [
      {
        startsAt: departure.trip.startsAt,
        endsAt: departure.trip.endsAt,
        meetingIdentityProof: proof,
      },
    ];
    for (const subject of [{ bookingId: "b-priya" }, { crewPersonId: "crew-dana" }])
      copy.events.push({
        clientEventId: crypto.randomUUID(),
        snapshotId: copy.snapshot.snapshotId,
        snapshotSavedAt: copy.snapshot.savedAt,
        tripId: "trip-1",
        ...subject,
        checkpoint: "departure",
        status: "not_boarded",
        meetingDay: 0,
        meetingIdentityProof: proof,
        occurredAt: copy.snapshot.savedAt,
        syncStatus: "pending",
        unresolvedReason: "unresolved_predecessor",
      });
    const dock = offlineTripView(copy, "departure");
    expect(dock?.localStates[0]).toBeUndefined();
    expect(dock?.crewWithState[0]?.state).toBeUndefined();
    const afterDive = offlineTripView(copy, "after_dive_1");
    expect(afterDive?.awaiting).toBe(2);
    expect(afterDive?.crewWithState[0]?.state).toBeUndefined();
    expect(afterDive?.rollCallComplete).toBe(false);
  });
  it("counts nobody called as awaiting, and the checkpoint as open", () => {
    const trip = view();
    expect(trip.totalDivers).toBe(2);
    expect(trip.awaiting).toBe(2);
    expect(trip.boarded).toBe(0);
    expect(trip.rollCallComplete).toBe(false);
    expect(trip.missingDivers.map((entry) => entry.bookingId)).toEqual(["b-priya", "b-marcus"]);
  });

  it("is null for a copy that carries no manifest", () => {
    const copy = savedCopy();
    expect(
      offlineTripView({ ...copy, snapshot: { ...copy.snapshot, manifests: [] } }, "departure"),
    ).toBeNull();
  });
});

describe("offlineTripView — certified total persons", () => {
  function fullBoat(limit: number | null = 12) {
    const copy = withMeetingProof(savedCopy());
    const manifest = copy.snapshot.manifests[0];
    if (!manifest) throw new Error("manifest missing");
    manifest.trip.certifiedTotalPersons = limit;
    manifest.trip.certifiedPassengers = 10;
    manifest.divers = Array.from({ length: 10 }, (_, index) => ({
      ...diver(`passenger-${index}`, `Passenger ${index}`),
      participantType: index === 0 ? "snorkeler" : index === 1 ? "rider" : "diver",
      rollCall: {
        state: "boarded",
        occurredAt: copy.snapshot.savedAt,
        recordedByName: "Captain",
      },
    }));
    manifest.crew = Array.from({ length: 3 }, (_, index) => ({
      id: `crew-${index}`,
      fullName: `Crew ${index}`,
      roles: ["captain"],
      rollCall: {
        state: "boarded",
        occurredAt: copy.snapshot.savedAt,
        recordedByName: "Captain",
      },
    }));
    // The summary is deliberately stale: this device's rows and queue decide.
    return copy;
  }

  it("warns for ten passengers of all kinds plus three crew against twelve persons", () => {
    const copy = fullBoat();
    const counted = offlineTripView(copy, "departure");
    expect(counted?.overTotalPersons).toEqual({ aboard: 13, limit: 12 });
    expect(counted?.boarded).toBe(10);
    expect(canRecordOfflineCrewStatus(copy.snapshot, "crew-0", "boarded", "departure")).toBe(true);
  });

  it("stays quiet at the limit or with no recorded limit", () => {
    expect(offlineTripView(fullBoat(13), "departure")?.overTotalPersons).toBeNull();
    expect(offlineTripView(fullBoat(null), "departure")?.overTotalPersons).toBeNull();
  });

  it("keeps an opaque opposing ashore tap in the aboard risk count", () => {
    const copy = fullBoat();
    copy.events = [
      {
        clientEventId: crypto.randomUUID(),
        snapshotId: copy.snapshot.snapshotId,
        snapshotSavedAt: copy.snapshot.savedAt,
        tripId: "trip-1",
        crewPersonId: "crew-0",
        checkpoint: "departure",
        status: "not_boarded",
        meetingDay: 0,
        meetingIdentityProof: TEST_MEETING_PROOF,
        occurredAt: copy.snapshot.savedAt,
        syncStatus: "pending",
      },
    ];
    const counted = offlineTripView(copy, "departure");
    expect(counted?.overTotalPersons).toEqual({ aboard: 13, limit: 12 });
    expect(counted?.rollCallComplete).toBe(false);
  });

  it("retains possible over-capacity risk while a dock correction is unresolved", () => {
    const copy = fullBoat();
    copy.events = [
      {
        clientEventId: crypto.randomUUID(),
        snapshotId: copy.snapshot.snapshotId,
        snapshotSavedAt: copy.snapshot.savedAt,
        tripId: "trip-1",
        crewPersonId: "crew-0",
        checkpoint: "departure",
        status: "not_boarded",
        meetingDay: 0,
        meetingIdentityProof: TEST_MEETING_PROOF,
        occurredAt: copy.snapshot.savedAt,
        syncStatus: "pending",
        unresolvedReason: "unresolved_predecessor",
      },
    ];
    const counted = offlineTripView(copy, "departure");
    expect(counted?.rollCallComplete).toBe(false);
    expect(counted?.possibleOverTotalPersons).toEqual({ aboard: 13, limit: 12 });
  });

  it("includes an unresolved boarding observation without calling it confirmed", () => {
    const copy = fullBoat();
    copy.snapshot.manifests[0].crew[0].rollCall = undefined;
    copy.events = [
      {
        clientEventId: crypto.randomUUID(),
        snapshotId: copy.snapshot.snapshotId,
        snapshotSavedAt: copy.snapshot.savedAt,
        tripId: "trip-1",
        crewPersonId: "crew-0",
        checkpoint: "departure",
        status: "boarded",
        meetingDay: 0,
        meetingIdentityProof: TEST_MEETING_PROOF,
        occurredAt: copy.snapshot.savedAt,
        syncStatus: "pending",
        unresolvedReason: "unresolved_predecessor",
      },
    ];
    const counted = offlineTripView(copy, "departure");
    expect(counted?.crewWithState[0].state).toBeUndefined();
    expect(counted?.overTotalPersons).toBeNull();
    expect(counted?.possibleOverTotalPersons).toEqual({ aboard: 13, limit: 12 });
  });

  for (const role of ["diver", "crew"] as const)
    for (const status of ["cleared", "not_boarded"] as const) {
      it(`keeps an earlier local ${role} boarding as possible after an unresolved ${status}`, () => {
        const copy = fullBoat();
        const manifest = copy.snapshot.manifests[0];
        const subject =
          role === "diver" ? { bookingId: "passenger-0" } : { crewPersonId: "crew-0" };
        if (role === "diver") manifest.divers[0].rollCall = undefined;
        else manifest.crew[0].rollCall = undefined;
        const aboard: OfflineRollCallEvent = {
          clientEventId: crypto.randomUUID(),
          snapshotId: copy.snapshot.snapshotId,
          snapshotSavedAt: copy.snapshot.savedAt,
          tripId: "trip-1",
          ...subject,
          checkpoint: "departure",
          status: "boarded",
          meetingDay: 0,
          meetingIdentityProof: TEST_MEETING_PROOF,
          occurredAt: copy.snapshot.savedAt,
          syncStatus: "pending",
        };
        const correction: OfflineRollCallEvent = {
          ...aboard,
          clientEventId: crypto.randomUUID(),
          status,
          observedEvidenceIds: [`client:${aboard.clientEventId}`],
          unresolvedReason: "unresolved_predecessor",
        };
        copy.events = [aboard, correction];
        const counted = offlineTripView(copy, "departure");
        expect(counted?.rollCallComplete).toBe(false);
        expect(counted?.possibleOverTotalPersons).toEqual({ aboard: 13, limit: 12 });
      });
    }

  it("retains a saved passenger as possibly aboard when their correction is unresolved", () => {
    const copy = fullBoat();
    copy.events = [
      {
        clientEventId: crypto.randomUUID(),
        snapshotId: copy.snapshot.snapshotId,
        snapshotSavedAt: copy.snapshot.savedAt,
        tripId: "trip-1",
        bookingId: "passenger-0",
        checkpoint: "departure",
        status: "not_boarded",
        meetingDay: 0,
        meetingIdentityProof: TEST_MEETING_PROOF,
        occurredAt: copy.snapshot.savedAt,
        syncStatus: "pending",
        unresolvedReason: "unresolved_predecessor",
      },
    ];
    const counted = offlineTripView(copy, "departure");
    expect(counted?.localStates[0]).toBeUndefined();
    expect(counted?.rollCallComplete).toBe(false);
    expect(counted?.possibleOverTotalPersons).toEqual({ aboard: 13, limit: 12 });
  });

  it("deduplicates a person with both roles in the possible capacity count", () => {
    const copy = fullBoat();
    copy.snapshot.manifests[0].divers[0].personId = "crew-0";
    copy.events = [
      {
        clientEventId: crypto.randomUUID(),
        snapshotId: copy.snapshot.snapshotId,
        snapshotSavedAt: copy.snapshot.savedAt,
        tripId: "trip-1",
        crewPersonId: "crew-0",
        checkpoint: "departure",
        status: "not_boarded",
        meetingDay: 0,
        meetingIdentityProof: TEST_MEETING_PROOF,
        occurredAt: copy.snapshot.savedAt,
        syncStatus: "pending",
        unresolvedReason: "unresolved_predecessor",
      },
    ];
    const counted = offlineTripView(copy, "departure");
    expect(counted?.rollCallComplete).toBe(false);
    expect(counted?.possibleOverTotalPersons).toBeNull();
  });

  it("keeps possible capacity risk visible after the dive", () => {
    const copy = fullBoat();
    const after = structuredClone(copy.snapshot.manifests[0]);
    after.checkpoint = "after_dive_1";
    after.crew[0].rollCall = undefined;
    copy.snapshot.manifests.push(after);
    copy.events = [
      {
        clientEventId: crypto.randomUUID(),
        snapshotId: copy.snapshot.snapshotId,
        snapshotSavedAt: copy.snapshot.savedAt,
        tripId: "trip-1",
        crewPersonId: "crew-0",
        checkpoint: "departure",
        status: "not_boarded",
        meetingDay: 0,
        meetingIdentityProof: TEST_MEETING_PROOF,
        occurredAt: copy.snapshot.savedAt,
        syncStatus: "pending",
        unresolvedReason: "unresolved_predecessor",
      },
    ];
    const counted = offlineTripView(copy, "after_dive_1");
    expect(counted?.rollCallComplete).toBe(false);
    expect(counted?.possibleOverTotalPersons).toEqual({ aboard: 13, limit: 12 });
  });

  for (const subject of [{ bookingId: "removed-booking" }, { crewPersonId: "removed-crew" }]) {
    it(`warns about an unlisted unresolved ${"bookingId" in subject ? "diver" : "crew member"} without inventing a count`, () => {
      const copy = fullBoat();
      copy.events = [
        {
          clientEventId: crypto.randomUUID(),
          snapshotId: copy.snapshot.snapshotId,
          snapshotSavedAt: copy.snapshot.savedAt,
          tripId: "trip-1",
          ...subject,
          checkpoint: "departure",
          status: "boarded",
          meetingDay: 0,
          meetingIdentityProof: TEST_MEETING_PROOF,
          occurredAt: copy.snapshot.savedAt,
          syncStatus: "pending",
          unresolvedReason: "unresolved_predecessor",
        },
      ];
      expect(offlineTripView(copy, "departure")?.possibleUnlistedPerson).toBe(true);
    });
    it("keeps a checkpoint open for an unlisted missing observation and its unresolved correction", () => {
      const copy = fullBoat(13);
      const departure = copy.snapshot.manifests[0];
      copy.snapshot.manifests.push({ ...structuredClone(departure), checkpoint: "after_dive_1" });
      expect(offlineTripView(copy, "after_dive_1")?.rollCallComplete).toBe(true);
      const first = {
        clientEventId: crypto.randomUUID(),
        snapshotId: copy.snapshot.snapshotId,
        snapshotSavedAt: copy.snapshot.savedAt,
        tripId: "trip-1",
        ...subject,
        checkpoint: "after_dive_1" as const,
        status: "not_boarded" as const,
        meetingDay: 0,
        meetingIdentityProof: TEST_MEETING_PROOF,
        occurredAt: copy.snapshot.savedAt,
        syncStatus: "pending" as const,
        unresolvedReason: "unresolved_predecessor" as const,
      };
      copy.events = [
        first,
        {
          ...first,
          clientEventId: crypto.randomUUID(),
          status: "boarded",
          observedEvidenceIds: [`client:${first.clientEventId}`],
        },
      ];
      const result = offlineTripView(copy, "after_dive_1");
      expect(result?.possibleUnlistedPerson).toBe(true);
      expect(result?.rollCallComplete).toBe(false);
      expect(result?.allBoarded).toBe(false);
    });
    for (const syncStatus of ["pending", "rejected"] as const) {
      it(`keeps a ${syncStatus} unlisted missing observation open even with a matching meeting proof`, () => {
        const copy = fullBoat(13);
        copy.snapshot.manifests.push({
          ...structuredClone(copy.snapshot.manifests[0]),
          checkpoint: "after_dive_1",
        });
        expect(offlineTripView(copy, "after_dive_1")?.rollCallComplete).toBe(true);
        copy.events = [
          {
            clientEventId: crypto.randomUUID(),
            snapshotId: copy.snapshot.snapshotId,
            snapshotSavedAt: copy.snapshot.savedAt,
            tripId: "trip-1",
            ...subject,
            checkpoint: "after_dive_1",
            status: "not_boarded",
            meetingDay: 0,
            meetingIdentityProof: TEST_MEETING_PROOF,
            occurredAt: copy.snapshot.savedAt,
            syncStatus,
          },
        ];
        const result = offlineTripView(copy, "after_dive_1");
        expect(result?.possibleUnlistedPerson).toBe(true);
        expect(result?.rollCallComplete).toBe(false);
        expect(result?.allBoarded).toBe(false);
      });
    }
    it("does not infer an unlisted missing person returned from a newer copy or an independent aboard mark", () => {
      const copy = fullBoat(13);
      copy.snapshot.manifests.push({
        ...structuredClone(copy.snapshot.manifests[0]),
        checkpoint: "after_dive_1",
      });
      copy.snapshot.erasureEpochToken = `3.9.${"a".repeat(43)}`;
      const first = {
        clientEventId: crypto.randomUUID(),
        snapshotId: copy.snapshot.snapshotId,
        snapshotSavedAt: copy.snapshot.savedAt,
        tripId: "trip-1",
        ...subject,
        checkpoint: "after_dive_1" as const,
        status: "not_boarded" as const,
        meetingDay: 0,
        meetingIdentityProof: TEST_MEETING_PROOF,
        occurredAt: copy.snapshot.savedAt,
        syncStatus: "applied" as const,
        syncedAtRevision: 5,
      };
      copy.events = [first, { ...first, clientEventId: crypto.randomUUID(), status: "boarded" }];
      const result = offlineTripView(copy, "after_dive_1");
      expect(result?.possibleUnlistedPerson).toBe(true);
      expect(result?.rollCallComplete).toBe(false);
      expect(result?.allBoarded).toBe(false);
    });
  }

  it("recounts queued crew and passenger changes, leaving offboard people out", () => {
    const copy = fullBoat();
    const ashore = (
      subject: { bookingId: string } | { crewPersonId: string },
    ): OfflineRollCallEvent => ({
      ...subject,
      clientEventId: crypto.randomUUID(),
      observedEvidenceIds: [identifySavedRollCall(copy.snapshot, subject, "departure", 0)],
      meetingDay: 0,
      meetingIdentityProof: TEST_MEETING_PROOF,
      snapshotId: copy.snapshot.snapshotId,
      snapshotSavedAt: copy.snapshot.savedAt,
      tripId: "trip-1",
      checkpoint: "departure",
      status: "not_boarded",
      occurredAt: "2026-08-01T12:30:00.000Z",
      syncStatus: "pending",
    });
    copy.events = [ashore({ crewPersonId: "crew-0" })];
    expect(offlineTripView(copy, "departure")?.overTotalPersons).toBeNull();
    copy.events = [ashore({ bookingId: "passenger-0" })];
    expect(offlineTripView(copy, "departure")?.overTotalPersons).toBeNull();
    copy.events = [];
    expect(offlineTripView(copy, "departure")?.overTotalPersons).toEqual({ aboard: 13, limit: 12 });
  });

  it("does not celebrate a full saved roster when retained safety evidence needs review", () => {
    const copy = fullBoat(13);
    expect(offlineTripView(copy, "departure")?.allBoarded).toBe(true);
    for (const manifest of copy.snapshot.manifests) manifest.retainedSafetyUnresolved = true;
    expect(offlineTripView(copy, "departure")).toMatchObject({
      allBoarded: false,
      rollCallComplete: false,
    });
  });
});

/**
 * **The after-dive readiness word on the offline copy** (issue #2286). The
 * live roll call keeps a blocked person's readiness on their row after a dive
 * when nobody boarded them earlier — a `boarded` there would be their first —
 * and the copy a captain reads with no signal must say the same. It reads
 * this device's own taps too, not only what the copy was saved with.
 */
describe("offlineTripView — blocked at the rail after a dive", () => {
  const boardedAtDock: OfflineRollCallEvent = {
    clientEventId: "event-1",
    snapshotId: "snap-trip-1",
    snapshotSavedAt: "2026-08-01T12:00:00.000Z",
    tripId: "trip-1",
    bookingId: "diver-priya",
    checkpoint: "departure",
    status: "boarded",
    meetingDay: 0,
    meetingIdentityProof: TEST_MEETING_PROOF,
    occurredAt: "2026-08-01T12:58:00.000Z",
    syncStatus: "pending",
  };

  it("marks a blocked diver nobody boarded at the dock", () => {
    const view = offlineTripView(richEnvelope("trip-1", { readiness: "blocked" }), "after_dive_1");
    expect(view?.blockedAtRail).toEqual([true]);
  });

  it("does not mark the same diver once this device boarded them at the dock", () => {
    const view = offlineTripView(
      withMeetingProof(
        richEnvelope("trip-1", { readiness: "blocked" }, { events: [boardedAtDock] }),
      ),
      "after_dive_1",
    );
    expect(view?.blockedAtRail).toEqual([false]);
  });

  it("reads earlier by checkpoint order, not by where the copy lists it", () => {
    const envelope = withMeetingProof(
      richEnvelope("trip-1", { readiness: "blocked" }, { events: [boardedAtDock] }),
    );
    const reversed = {
      ...envelope,
      snapshot: { ...envelope.snapshot, manifests: [...envelope.snapshot.manifests].reverse() },
    };
    expect(offlineTripView(reversed, "after_dive_1")?.blockedAtRail).toEqual([false]);
  });

  it("does not mark a ready diver, and marks a blocked one at the dock", () => {
    expect(offlineTripView(richEnvelope("trip-1"), "after_dive_1")?.blockedAtRail).toEqual([false]);
    expect(
      offlineTripView(richEnvelope("trip-1", { readiness: "blocked" }), "departure")?.blockedAtRail,
    ).toEqual([true]);
  });
});

/**
 * **A medical block after a dive, offline** (issue #2380): the same predicate
 * the live roll call reads (`medicalHoldAfterDive`), off this device's own
 * taps as well as the saved copy, so the two never disagree.
 */
describe("offlineTripView — a medical block after a dive", () => {
  const boardedAtDock: OfflineRollCallEvent = {
    clientEventId: "event-1",
    snapshotId: "snap-trip-1",
    snapshotSavedAt: "2026-08-01T12:00:00.000Z",
    tripId: "trip-1",
    bookingId: "diver-priya",
    checkpoint: "departure",
    status: "boarded",
    meetingDay: 0,
    meetingIdentityProof: TEST_MEETING_PROOF,
    occurredAt: "2026-08-01T12:58:00.000Z",
    syncStatus: "pending",
  };
  function medicallyBlocked(events: OfflineRollCallEvent[]) {
    const envelope = withMeetingProof(richEnvelope("trip-1", { readiness: "blocked" }, { events }));
    for (const manifest of envelope.snapshot.manifests) {
      for (const diver of manifest.divers) {
        if (diver.readiness.status === "blocked") {
          diver.readiness.blockers = [
            { code: "medical_not_cleared", text: "Physician did not clear" },
          ];
        }
      }
    }
    return envelope;
  }

  it("names it for a diver this device boarded over it at the dock", () => {
    const view = offlineTripView(medicallyBlocked([boardedAtDock]), "after_dive_1");
    expect(view?.medicalHold).toEqual(["medical_not_cleared"]);
    expect(view?.blockedAtRail).toEqual([false]);
  });

  it("stays quiet at the dock and for a diver nobody boarded, where Blocked speaks", () => {
    expect(offlineTripView(medicallyBlocked([boardedAtDock]), "departure")?.medicalHold).toEqual([
      null,
    ]);
    const unboarded = offlineTripView(medicallyBlocked([]), "after_dive_1");
    expect(unboarded?.medicalHold).toEqual([null]);
    expect(unboarded?.blockedAtRail).toEqual([true]);
  });

  it("gives way to the not-back alarm", () => {
    const notBack: OfflineRollCallEvent = {
      ...boardedAtDock,
      clientEventId: "event-2",
      checkpoint: "after_dive_1",
      status: "not_boarded",
      occurredAt: "2026-08-01T14:10:00.000Z",
    };
    expect(
      offlineTripView(medicallyBlocked([boardedAtDock, notBack]), "after_dive_1")?.medicalHold,
    ).toEqual([null]);
  });
});
