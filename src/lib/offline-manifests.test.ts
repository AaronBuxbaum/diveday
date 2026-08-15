import { describe, expect, it } from "vitest";
import type { TripManifest } from "./manifests";
import {
  canRecordOfflineCrewStatus,
  canRecordOfflineStatus,
  isOfflineManifestExpired,
  latestOfflineCrewRollCall,
  latestOfflineRollCall,
  OFFLINE_MANIFEST_RECORD_VERSION,
  type OfflineManifestSnapshot,
  offlineManifestExpiresAt,
  offlineManifestFreshness,
  offlineRollCallSubject,
  serializeManifests,
} from "./offline-manifests";

/**
 * A copy with crew on it, in the two shapes a device can actually be holding:
 * one saved since H-46, whose crew carry person ids and are therefore
 * recordable here, and one saved before it, whose crew carry none and are not.
 * Both have to render and both have to fail closed; only one has controls.
 */
function crewSnapshot(opts: { withIds?: boolean } = {}): OfflineManifestSnapshot {
  const withIds = opts.withIds ?? true;
  const saved = snapshot();
  for (const manifest of saved.manifests) {
    manifest.crew = [
      { id: withIds ? "crew-dana" : undefined, fullName: "Dana Divemaster", roles: ["divemaster"] },
      { id: withIds ? "crew-sal" : undefined, fullName: "Sal Ortiz", roles: ["captain"] },
    ];
  }
  return saved;
}

/**
 * One manifest per checkpoint, the way a real snapshot is built: the payload
 * comes from `getTripManifests`, which returns the whole `rollCallCheckpoints`
 * list for the trip's planned-dive count. The fixture used to carry only the
 * "departure" manifest, which is what let `canRecordOfflineStatus` read
 * `manifests[0]` for years without a test noticing (DOM-L4).
 */
function snapshot(): OfflineManifestSnapshot {
  const checkpoints = ["departure", "after_dive_1", "after_dive_2"] as const;
  return {
    version: OFFLINE_MANIFEST_RECORD_VERSION,
    snapshotId: "snapshot-1",
    savedAt: "2026-07-20T11:00:00.000Z",
    expiresAt: "2026-07-27T16:00:00.000Z",
    shop: { slug: "blue-mantis", name: "Blue Mantis", timezone: "America/New_York" },
    manifests: checkpoints.map((checkpoint) => ({
      trip: {
        id: "trip-1",
        title: "Two-Tank Reef",
        startsAt: "2026-07-20T12:00:00.000Z",
        endsAt: "2026-07-20T16:00:00.000Z",
        plannedDives: 2,
      },
      checkpoint,
      crew: [],
      summary: {
        totalDivers: 2,
        ready: 1,
        blocked: 1,
        boarded: 0,
        notBoarded: 0,
        notBackAboard: 0,
        awaiting: 2,
        unaccountedFor: 2,
      },
      divers: [
        {
          bookingId: "ready",
          fullName: "Ready Diver",
          email: null,
          emergencyContactName: null,
          emergencyContactPhone: null,
          readiness: { status: "ready", blockers: [] },
          rentalFit: { state: "not_recorded" as const },
          nitroxRequested: false,
        },
        {
          bookingId: "blocked",
          fullName: "Blocked Diver",
          email: null,
          emergencyContactName: null,
          emergencyContactPhone: null,
          readiness: {
            status: "blocked",
            blockers: [{ code: "waiver_pending", text: "Waiver pending." }],
          },
          rentalFit: { state: "not_recorded" as const },
          nitroxRequested: false,
        },
      ],
    })),
  };
}

describe("offline manifest policy", () => {
  it("labels freshness without hiding an old snapshot", () => {
    const saved = new Date("2026-07-20T11:00:00.000Z");
    expect(offlineManifestFreshness(saved, new Date("2026-07-20T11:10:00.000Z"))).toBe("current");
    expect(offlineManifestFreshness(saved, new Date("2026-07-20T13:00:00.000Z"))).toBe("aging");
    expect(offlineManifestFreshness(saved, new Date("2026-07-20T20:00:00.000Z"))).toBe("stale");
  });

  it("expires at the earlier privacy boundary", () => {
    const saved = new Date("2026-07-20T11:00:00.000Z");
    expect(offlineManifestExpiresAt(saved, new Date("2026-07-20T16:00:00.000Z"))).toEqual(
      new Date("2026-07-27T16:00:00.000Z"),
    );
  });

  it("treats a snapshot as expired only once its expiresAt has actually passed", () => {
    const saved = snapshot();
    expect(saved.expiresAt).toBe("2026-07-27T16:00:00.000Z");
    expect(isOfflineManifestExpired(saved, new Date("2026-07-27T15:59:59.000Z"))).toBe(false);
    expect(isOfflineManifestExpired(saved, new Date("2026-07-27T16:00:00.000Z"))).toBe(true);
    expect(isOfflineManifestExpired(saved, new Date("2026-08-01T00:00:00.000Z"))).toBe(true);
  });

  it("never lets a snapshot board a missing or blocked diver at departure", () => {
    const saved = snapshot();
    expect(canRecordOfflineStatus(saved, "ready", "boarded", "departure")).toBe(true);
    expect(canRecordOfflineStatus(saved, "blocked", "boarded", "departure")).toBe(false);
    expect(canRecordOfflineStatus(saved, "blocked", "not_boarded", "departure")).toBe(true);
    expect(canRecordOfflineStatus(saved, "missing", "not_boarded", "departure")).toBe(false);
  });

  // Dive-domain-expert review (docs/product/archive/ux-personas-20260730-findings.md,
  // persona 10 Sal, task 72, invariant 2): the UI shows a live "Board" button
  // after any numbered dive regardless of readiness (`ready || !isDeparture`
  // in OfflineManifestView) because post-departure roll call is a pure head
  // count. `canRecordOfflineStatus` is the real fail-closed authority and
  // must agree — it used to ignore checkpoint entirely and always re-check
  // readiness, silently refusing exactly the board the UI implies will
  // succeed. This mirrors the server's own gate (`recordRollCall` in
  // src/db/manifests.ts: `status === "boarded" && checkpoint === "departure"`).
  it("still allows boarding a not-ready diver after a numbered dive as a pure headcount", () => {
    const saved = snapshot();
    // A missing/uncleared medical, unresolved at departure.
    expect(canRecordOfflineStatus(saved, "blocked", "boarded", "departure")).toBe(false);
    // The same diver, same unresolved readiness, at a post-departure
    // checkpoint — must succeed. This is the case that regresses without the
    // checkpoint gate.
    expect(canRecordOfflineStatus(saved, "blocked", "boarded", "after_dive_1")).toBe(true);
    expect(canRecordOfflineStatus(saved, "blocked", "boarded", "after_dive_2")).toBe(true);
    // Readiness still gates a fresh board attempt at departure itself, even
    // when other checkpoints exist on the same snapshot.
    expect(canRecordOfflineStatus(saved, "blocked", "boarded", "departure")).toBe(false);
  });

  it("never lets an unknown bookingId board at any checkpoint", () => {
    const saved = snapshot();
    expect(canRecordOfflineStatus(saved, "missing", "boarded", "after_dive_1")).toBe(false);
    expect(canRecordOfflineStatus(saved, "missing", "not_boarded", "after_dive_1")).toBe(false);
  });

  // DOM-L4 (review 20260802): the roster came from `manifests[0]` no matter
  // which checkpoint was asked about, while `latestOfflineRollCall` right
  // beside it already looked the checkpoint up. Identical per-checkpoint diver
  // lists hid it. Here they diverge — a booking on the departure manifest only,
  // and one on the after-dive manifests only — and the two answers must follow
  // the checkpoint asked about, not whichever manifest happens to be first.
  //
  // **No production path produces a diverging roster today**: `getTripManifests`
  // maps one manifest per checkpoint over the same diver list. This is what
  // stops that mattering when it changes, not a description of a state the
  // product currently reaches — do not read it as licence to write code that
  // assumes the lists differ.
  it("reads the roster from the checkpoint's own manifest, not the first one", () => {
    const saved = snapshot();
    const departure = saved.manifests.find((manifest) => manifest.checkpoint === "departure");
    const afterDive1 = saved.manifests.find((manifest) => manifest.checkpoint === "after_dive_1");
    if (!departure || !afterDive1) throw new Error("fixture lost a checkpoint");
    const diver = (bookingId: string) => ({
      ...departure.divers[0],
      bookingId,
      fullName: bookingId,
    });
    departure.divers.push(diver("departure-only"));
    afterDive1.divers.push(diver("after-dive-only"));

    // Off the departure manifest by the time dive 1 ends: refused there, which
    // is the fail-closed direction. `manifests[0]` said yes.
    expect(canRecordOfflineStatus(saved, "departure-only", "boarded", "departure")).toBe(true);
    expect(canRecordOfflineStatus(saved, "departure-only", "boarded", "after_dive_1")).toBe(false);

    // And the reverse: someone the after-dive manifest carries is boardable
    // there even though the departure manifest never held them.
    expect(canRecordOfflineStatus(saved, "after-dive-only", "boarded", "after_dive_1")).toBe(true);
    expect(canRecordOfflineStatus(saved, "after-dive-only", "boarded", "departure")).toBe(false);

    // Neither refusal reaches the alarm: both are real people on this copy, so
    // "did not come back" stays recordable at every checkpoint.
    expect(canRecordOfflineStatus(saved, "departure-only", "not_boarded", "after_dive_1")).toBe(
      true,
    );
    expect(canRecordOfflineStatus(saved, "after-dive-only", "not_boarded", "departure")).toBe(true);
  });

  // A checkpoint the snapshot does not carry at all — a trip whose planned-dive
  // count shrank after the copy was saved, or a hand-edited URL. The two
  // directions part company here, and the asymmetry is the safety property
  // (dive-domain-expert review, 2026-08-06): boarding needs the checkpoint's own
  // list and refuses without it, while "this person did not come back" is true
  // regardless of which list the copy happens to hold and must never be refused
  // — a crew member who cannot log a missing diver has been silenced.
  it("refuses to board at a checkpoint the snapshot has no manifest for, but never refuses the alarm", () => {
    const saved = snapshot();
    expect(canRecordOfflineStatus(saved, "ready", "boarded", "after_dive_3")).toBe(false);
    expect(canRecordOfflineStatus(saved, "ready", "not_boarded", "after_dive_3")).toBe(true);
    // Still nobody, though: an unknown booking is refused in both directions,
    // because there is no person behind the id to be missing.
    expect(canRecordOfflineStatus(saved, "missing", "not_boarded", "after_dive_3")).toBe(false);
  });

  it("uses the latest non-rejected device event and exposes pending state", () => {
    const saved = snapshot();
    const latest = latestOfflineRollCall(
      saved,
      [
        {
          clientEventId: "event-1",
          snapshotId: saved.snapshotId,
          snapshotSavedAt: saved.savedAt,
          tripId: "trip-1",
          bookingId: "ready",
          checkpoint: "departure",
          status: "boarded",
          note: null,
          occurredAt: "2026-07-20T11:05:00.000Z",
          syncStatus: "pending",
        },
      ],
      "ready",
      "departure",
    );
    expect(latest).toEqual({
      state: "boarded",
      occurredAt: "2026-07-20T11:05:00.000Z",
      pending: true,
      implied: false,
    });
  });

  // Dive-domain-expert review (docs/product/features/story-backlog.md, Sal): the old
  // implementation filtered out rejected events *before* picking "the
  // latest," so a rejected correction fell through to an older, superseded
  // local event instead of the snapshot's own server value — reasserting the
  // stale write reconciliation was supposed to overrule. A diver marked
  // "boarded" then corrected to "not_boarded," where the correction is
  // rejected on sync (e.g. another device's write landed first), must never
  // keep reading "boarded".
  it("falls back to the snapshot value, not a superseded local event, when the latest attempt was rejected", () => {
    const saved = snapshot();
    const latest = latestOfflineRollCall(
      saved,
      [
        {
          clientEventId: "event-older-applied",
          snapshotId: saved.snapshotId,
          snapshotSavedAt: saved.savedAt,
          tripId: "trip-1",
          bookingId: "ready",
          checkpoint: "departure",
          status: "boarded",
          note: null,
          occurredAt: "2026-07-20T11:00:00.000Z",
          syncStatus: "applied",
        },
        {
          clientEventId: "event-newer-rejected",
          snapshotId: saved.snapshotId,
          snapshotSavedAt: saved.savedAt,
          tripId: "trip-1",
          bookingId: "ready",
          checkpoint: "departure",
          status: "not_boarded",
          note: null,
          occurredAt: "2026-07-20T11:10:00.000Z",
          syncStatus: "rejected",
        },
      ],
      "ready",
      "departure",
    );
    // No server-side rollCall recorded for "ready" in the fixture snapshot,
    // so the correct fallback is undefined — never the older "boarded" event.
    expect(latest).toBeUndefined();
  });

  it("surfaces a carried-forward not-boarded from the snapshot as implied", () => {
    const saved = snapshot();
    saved.manifests[0]?.divers.push({
      bookingId: "carried",
      fullName: "Carried Diver",
      email: null,
      emergencyContactName: null,
      emergencyContactPhone: null,
      readiness: { status: "ready", blockers: [] },
      rentalFit: { state: "not_recorded" },
      nitroxRequested: false,
      rollCall: {
        state: "not_boarded",
        occurredAt: "2026-07-20T11:02:00.000Z",
        recordedByName: "Dana Divemaster",
        note: "Left after dive 1",
        implied: true,
      },
    });

    const carried = latestOfflineRollCall(saved, [], "carried", "departure");
    expect(carried).toEqual({
      state: "not_boarded",
      occurredAt: "2026-07-20T11:02:00.000Z",
      pending: false,
      implied: true,
    });
  });

  it("treats a device-recorded not-boarded as explicit, never carried", () => {
    const saved = snapshot();
    const latest = latestOfflineRollCall(
      saved,
      [
        {
          clientEventId: "event-2",
          snapshotId: saved.snapshotId,
          snapshotSavedAt: saved.savedAt,
          tripId: "trip-1",
          bookingId: "blocked",
          checkpoint: "departure",
          status: "not_boarded",
          note: null,
          occurredAt: "2026-07-20T11:06:00.000Z",
          syncStatus: "pending",
        },
      ],
      "blocked",
      "departure",
    );
    expect(latest?.implied).toBe(false);
  });

  it("carries the implied flag through serialization", () => {
    const manifest: TripManifest = {
      trip: {
        id: "trip-1",
        title: "Two-Tank Reef",
        startsAt: new Date("2026-07-20T12:00:00.000Z"),
        endsAt: new Date("2026-07-20T16:00:00.000Z"),
        plannedDives: 2,
      },
      checkpoint: "after_dive_1",
      crew: [],
      completeness: {
        complete: false,
        diversAccountedFor: true,
        crewAccountedFor: false,
        reason: "crew_none_assigned",
        crewReason: "crew_none_assigned",
        crewCounts: {
          crewAwaiting: 0,
          crewNotBackAboard: 0,
          crewAshore: 0,
          crewAssigned: 0,
        },
      },
      divers: [
        {
          bookingId: "carried",
          fullName: "Carried Diver",
          email: "carried@example.com",
          emergencyContactName: null,
          emergencyContactPhone: null,
          readiness: { status: "ready", blockers: [] },
          rentalFit: { state: "own_kit" },
          nitroxRequested: false,
          checkedIn: false,
          rollCall: {
            state: "not_boarded",
            occurredAt: new Date("2026-07-20T13:30:00.000Z"),
            recordedByName: "Dana Divemaster",
            note: null,
            implied: true,
          },
          buddyAlert: null,
        },
      ],
      summary: {
        totalDivers: 1,
        ready: 1,
        blocked: 0,
        boarded: 0,
        notBoarded: 1,
        notBackAboard: 0,
        awaiting: 0,
        unaccountedFor: 0,
      },
    };

    const payload = serializeManifests(
      [manifest],
      { slug: "blue-mantis", name: "Blue Mantis", timezone: "America/New_York" },
      (blocker) => blocker.code,
    );
    expect(payload.manifests[0]?.divers[0]?.rollCall).toEqual({
      state: "not_boarded",
      occurredAt: "2026-07-20T13:30:00.000Z",
      recordedByName: "Dana Divemaster",
      note: null,
      implied: true,
    });
    // Private data the dock does not need is still dropped.
    expect(payload.manifests[0]?.divers[0]?.email).toBeNull();
  });

  it("carries a buddy as a name only — never an id, never a computed divergence", () => {
    // The dock copy *displays* buddy teams; whether a pair is split is a
    // live-roll-call read, and a snapshot cannot know who came back (ADR
    // 20260804-buddy-teams). Shipping only the name is what keeps that
    // derivation impossible offline rather than merely unimplemented.
    const manifest: TripManifest = {
      trip: {
        id: "trip-1",
        title: "Two-Tank Reef",
        startsAt: new Date("2026-07-20T12:00:00.000Z"),
        endsAt: new Date("2026-07-20T16:00:00.000Z"),
        plannedDives: 2,
      },
      checkpoint: "after_dive_1",
      crew: [],
      completeness: {
        complete: false,
        diversAccountedFor: false,
        crewAccountedFor: false,
        reason: "divers_awaiting",
        crewReason: "crew_none_assigned",
        crewCounts: {
          crewAwaiting: 0,
          crewNotBackAboard: 0,
          crewAshore: 0,
          crewAssigned: 0,
        },
      },
      divers: [
        {
          bookingId: "booking-tom",
          fullName: "Tom Okafor",
          email: "tom@example.com",
          emergencyContactName: null,
          emergencyContactPhone: null,
          readiness: { status: "ready", blockers: [] },
          rentalFit: { state: "own_kit" },
          nitroxRequested: false,
          checkedIn: false,
          buddyTeam: {
            teamId: "team-1",
            others: [
              { kind: "diver", bookingId: "booking-lena", fullName: "Lena Fischer" },
              { kind: "crew", personId: "person-keiko", fullName: "Keiko Tanaka" },
            ],
          },
          rollCall: {
            state: "boarded",
            occurredAt: new Date("2026-07-20T13:30:00.000Z"),
            recordedByName: "Dana Divemaster",
            note: null,
          },
          buddyAlert: "separated_after_dive",
        },
        {
          bookingId: "booking-omar",
          fullName: "Omar Haddad",
          email: null,
          emergencyContactName: null,
          emergencyContactPhone: null,
          readiness: { status: "ready", blockers: [] },
          rentalFit: { state: "own_kit" },
          nitroxRequested: false,
          checkedIn: false,
          rollCall: undefined,
          buddyAlert: null,
        },
      ],
      summary: {
        totalDivers: 2,
        ready: 2,
        blocked: 0,
        boarded: 1,
        notBoarded: 0,
        notBackAboard: 0,
        awaiting: 1,
        unaccountedFor: 1,
      },
    };

    const payload = serializeManifests(
      [manifest],
      { slug: "blue-mantis", name: "Blue Mantis", timezone: "America/New_York" },
      (blocker) => blocker.code,
    );
    const [tom, omar] = payload.manifests[0]?.divers ?? [];
    // Every teammate, crew included, by name — and only by name.
    expect(tom?.buddyTeamNames).toEqual(["Lena Fischer", "Keiko Tanaka"]);
    // An unteamed diver stays honestly empty rather than absent-by-accident.
    expect(omar?.buddyTeamNames).toEqual([]);
    // Neither a teammate's id nor the live alert crosses to the device — an id
    // would invite computing a divergence a snapshot cannot know.
    expect(tom).not.toHaveProperty("buddyTeam");
    expect(tom).not.toHaveProperty("buddyAlert");
    expect(JSON.stringify(tom)).not.toContain("booking-lena");
    expect(JSON.stringify(tom)).not.toContain("person-keiko");
  });

  it("never writes age, minor status, or birthdays to a crew device", () => {
    // H-21 put these on the roster and the live manifest — staff screens. The
    // offline copy is different: it persists to a personal phone for up to two
    // weeks with no delete button, nothing renders these fields there, and they
    // describe children. The payload type is an allow-list so a future field
    // can't repeat the mistake; this asserts the behaviour that type protects.
    const manifest: TripManifest = {
      trip: {
        id: "trip-1",
        title: "Two-Tank Reef",
        startsAt: new Date("2026-07-20T12:00:00.000Z"),
        endsAt: new Date("2026-07-20T16:00:00.000Z"),
        plannedDives: 2,
      },
      checkpoint: "departure",
      crew: [],
      completeness: {
        complete: false,
        diversAccountedFor: false,
        crewAccountedFor: false,
        reason: "divers_awaiting",
        crewReason: "crew_none_assigned",
        crewCounts: {
          crewAwaiting: 0,
          crewNotBackAboard: 0,
          crewAshore: 0,
          crewAssigned: 0,
        },
      },
      divers: [
        {
          bookingId: "booking-1",
          fullName: "Lena Fischer",
          email: "lena@example.com",
          emergencyContactName: null,
          emergencyContactPhone: null,
          readiness: { status: "ready", blockers: [] },
          rentalFit: { state: "own_kit" },
          nitroxRequested: false,
          checkedIn: false,
          age: 12,
          minor: true,
          birthday: { status: "today" },
          rollCall: undefined,
          buddyAlert: null,
        },
      ],
      summary: {
        totalDivers: 1,
        ready: 1,
        blocked: 0,
        boarded: 0,
        notBoarded: 0,
        notBackAboard: 0,
        awaiting: 1,
        unaccountedFor: 1,
      },
    };

    const payload = serializeManifests(
      [manifest],
      { slug: "blue-mantis", name: "Blue Mantis", timezone: "America/New_York" },
      (blocker) => blocker.code,
    );
    const diver = payload.manifests[0]?.divers[0] as Record<string, unknown> | undefined;
    expect(diver).toBeDefined();
    expect(diver).not.toHaveProperty("age");
    expect(diver).not.toHaveProperty("minor");
    expect(diver).not.toHaveProperty("birthday");
    // The serialized JSON is what actually lands in IndexedDB — check there too,
    // so an inherited property could never sneak past the assertions above.
    expect(JSON.stringify(payload)).not.toContain("minor");
    expect(JSON.stringify(payload)).not.toContain("birthday");
  });
});

/**
 * The crew half of the head count, with the radio off (H-46). Everything here
 * is written against one failure direction: **offline reading "closed" while
 * online says otherwise** — a checkpoint that looks finished while somebody is
 * still in the water. Every refusal below holds the checkpoint open; none of
 * them closes it.
 */
describe("offline crew roll call", () => {
  it("refuses every crew member on a copy saved before crew ids, so the checkpoint stays open", () => {
    const old = crewSnapshot({ withIds: false });
    // There is no subject to write against, so there is nothing to record —
    // in either direction, at any checkpoint. That is the pre-H-46 behaviour
    // preserved exactly for the copies already sitting on devices (I2).
    expect(canRecordOfflineCrewStatus(old, "crew-dana", "boarded", "departure")).toBe(false);
    expect(canRecordOfflineCrewStatus(old, "crew-dana", "not_boarded", "after_dive_1")).toBe(false);
    // And an empty id — what `member.id` actually is on that copy — is refused
    // rather than matching the first crew member whose id is also absent.
    expect(canRecordOfflineCrewStatus(old, "", "not_boarded", "after_dive_1")).toBe(false);
    // The crew half therefore has no results, which `crewRollCallCounts` reads
    // as awaiting — never as accounted for.
    expect(old.manifests[0]?.crew.every((member) => !member.rollCall)).toBe(true);
  });

  it("boards a crew member at departure with no readiness question asked", () => {
    const saved = crewSnapshot();
    // The diver beside them can be refused at the dock for a pending waiver;
    // a divemaster has no waiver, no payment and no card to check, and
    // `recordCrewRollCall` has no readiness gate either.
    expect(canRecordOfflineCrewStatus(saved, "crew-dana", "boarded", "departure")).toBe(true);
    expect(canRecordOfflineStatus(saved, "blocked", "boarded", "departure")).toBe(false);
  });

  it("never lets an unknown person id be recorded, in either direction", () => {
    const saved = crewSnapshot();
    // No name behind the id, so the event would be a claim about nobody.
    expect(canRecordOfflineCrewStatus(saved, "crew-nobody", "boarded", "departure")).toBe(false);
    expect(canRecordOfflineCrewStatus(saved, "crew-nobody", "not_boarded", "after_dive_1")).toBe(
      false,
    );
    // A booking id is not a person id and must not cross over.
    expect(canRecordOfflineCrewStatus(saved, "ready", "not_boarded", "after_dive_1")).toBe(false);
  });

  it("refuses to board at a checkpoint the snapshot has no manifest for, but never refuses the alarm", () => {
    const saved = crewSnapshot();
    // Same asymmetry the diver path has, and for the same reason: after a
    // numbered dive `not_boarded` means *this person did not come back*, and a
    // gap in the saved copy's contents never makes that less true or gives the
    // deck a reason to stay quiet.
    expect(canRecordOfflineCrewStatus(saved, "crew-sal", "boarded", "after_dive_3")).toBe(false);
    expect(canRecordOfflineCrewStatus(saved, "crew-sal", "not_boarded", "after_dive_3")).toBe(true);
    // Still nobody, though.
    expect(canRecordOfflineCrewStatus(saved, "crew-nobody", "not_boarded", "after_dive_3")).toBe(
      false,
    );
  });

  it("reads a crew member's own device events, and never a diver's", () => {
    const saved = crewSnapshot();
    const events = [
      {
        clientEventId: "event-crew",
        snapshotId: saved.snapshotId,
        snapshotSavedAt: saved.savedAt,
        tripId: "trip-1",
        crewPersonId: "crew-dana",
        checkpoint: "after_dive_1" as const,
        status: "not_boarded" as const,
        note: null,
        occurredAt: "2026-07-20T14:05:00.000Z",
        syncStatus: "pending" as const,
      },
      {
        clientEventId: "event-diver",
        snapshotId: saved.snapshotId,
        snapshotSavedAt: saved.savedAt,
        tripId: "trip-1",
        bookingId: "ready",
        checkpoint: "after_dive_1" as const,
        status: "boarded" as const,
        note: null,
        occurredAt: "2026-07-20T14:06:00.000Z",
        syncStatus: "pending" as const,
      },
    ];
    expect(latestOfflineCrewRollCall(saved, events, "crew-dana", "after_dive_1")).toEqual({
      state: "not_boarded",
      occurredAt: "2026-07-20T14:05:00.000Z",
      pending: true,
      implied: false,
    });
    // The other crew member has said nothing — absence is awaiting, which is
    // what keeps the checkpoint open.
    expect(latestOfflineCrewRollCall(saved, events, "crew-sal", "after_dive_1")).toBeUndefined();
    // And the two subject spaces do not leak into one another.
    expect(latestOfflineRollCall(saved, events, "ready", "after_dive_1")?.state).toBe("boarded");
    expect(latestOfflineCrewRollCall(saved, events, "ready", "after_dive_1")).toBeUndefined();
  });

  it("falls back to the saved result, not a superseded local event, when the latest crew attempt was rejected", () => {
    const saved = crewSnapshot();
    const afterDive1 = saved.manifests.find((manifest) => manifest.checkpoint === "after_dive_1");
    const dana = afterDive1?.crew.find((member) => member.id === "crew-dana");
    if (!dana) throw new Error("fixture lost a crew member");
    dana.rollCall = {
      state: "not_boarded",
      occurredAt: "2026-07-20T14:30:00.000Z",
      recordedByName: "Sal Ortiz",
      note: null,
    };
    const event = {
      clientEventId: "event-crew",
      snapshotId: saved.snapshotId,
      snapshotSavedAt: saved.savedAt,
      tripId: "trip-1",
      crewPersonId: "crew-dana",
      checkpoint: "after_dive_1" as const,
      status: "boarded" as const,
      note: null,
      occurredAt: "2026-07-20T14:05:00.000Z",
      syncStatus: "rejected" as const,
    };
    // The server knows something this device does not, so the rejected
    // "boarded" must not keep reading aboard beside a divemaster the live page
    // says did not come back.
    expect(latestOfflineCrewRollCall(saved, [event], "crew-dana", "after_dive_1")).toEqual({
      state: "not_boarded",
      occurredAt: "2026-07-20T14:30:00.000Z",
      pending: false,
      implied: false,
    });
  });

  it("attributes an event to exactly one subject, and refuses to guess", () => {
    expect(offlineRollCallSubject({ bookingId: "booking-1" })).toEqual({
      kind: "diver",
      bookingId: "booking-1",
    });
    expect(offlineRollCallSubject({ crewPersonId: "crew-dana" })).toEqual({
      kind: "crew",
      crewPersonId: "crew-dana",
    });
    // Neither is a claim about nobody; both is a claim two recorders cannot
    // both honour. Different mistakes, same safe answer.
    expect(offlineRollCallSubject({})).toBeNull();
    expect(
      offlineRollCallSubject({ bookingId: "booking-1", crewPersonId: "crew-dana" }),
    ).toBeNull();
    // An empty string is not a subject either — that is what a widened type
    // plus a hand-built object can produce.
    expect(offlineRollCallSubject({ bookingId: "" })).toBeNull();
  });
});
