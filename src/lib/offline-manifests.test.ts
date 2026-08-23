import { describe, expect, it } from "vitest";
import { EMPTY_EMERGENCY_REFERENCE } from "./emergency-reference";
import type { TripManifest } from "./manifests";
import {
  canRecordOfflineCrewStatus,
  canRecordOfflineStatus,
  isOfflineManifestExpired,
  latestOfflineCrewRollCall,
  latestOfflineRollCall,
  OFFLINE_MANIFEST_RECORD_VERSION,
  type OfflineManifestSnapshot,
  offlineManifestAge,
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
    shop: {
      slug: "blue-mantis",
      name: "Blue Mantis",
      timezone: "America/New_York",
      emergencyReference: EMPTY_EMERGENCY_REFERENCE,
    },
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

  it("reports an age as a unit and a magnitude, floored the way an '… ago' reads", () => {
    const saved = new Date("2026-07-20T11:00:00.000Z");
    const at = (iso: string) => offlineManifestAge(saved, new Date(iso));

    expect(at("2026-07-20T11:16:00.000Z")).toEqual({ unit: "minute", value: 16 });
    // 59m59s is still "59 minutes", not an hour that has not happened yet.
    expect(at("2026-07-20T11:59:59.000Z")).toEqual({ unit: "minute", value: 59 });
    expect(at("2026-07-20T15:00:00.000Z")).toEqual({ unit: "hour", value: 4 });
    // 1h59m floors down to one hour, never up to two.
    expect(at("2026-07-20T12:59:00.000Z")).toEqual({ unit: "hour", value: 1 });
    expect(at("2026-07-23T11:00:00.000Z")).toEqual({ unit: "day", value: 3 });
    // A clock that has gone backwards on the device reports no age at all
    // rather than a negative one the formatter would render as the future.
    expect(at("2026-07-20T10:00:00.000Z")).toEqual({ unit: "minute", value: 0 });
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
      local: true,
      // Which of this device's queued events the row is showing — the id a
      // retraction of it has to name (ADR
      // 20260815-an-offline-retraction-names-its-target).
      clientEventId: "event-1",
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

  /*
   * The other half of that rule, and the half it was missing (ADR
   * 20260815-a-rejected-correction-may-not-silence-a-missing-diver): the
   * snapshot fallback is right about *optimism* and wrong about the alarm.
   *
   * Crew mark a diver not back aboard after dive 1; they queue a correction to
   * boarded; the server rejects it. Falling through to the snapshot — which
   * holds nothing for that diver at an after-dive checkpoint — took the
   * loudest row the product has off the screen and replaced it with
   * "awaiting", on the device the crew is holding.
   */
  it("keeps a recorded not-back-aboard on screen when the correction is rejected after a dive", () => {
    const saved = snapshot();
    const latest = latestOfflineRollCall(
      saved,
      [
        {
          clientEventId: "event-missing",
          snapshotId: saved.snapshotId,
          snapshotSavedAt: saved.savedAt,
          tripId: "trip-1",
          bookingId: "ready",
          checkpoint: "after_dive_1",
          status: "not_boarded",
          note: null,
          occurredAt: "2026-07-20T14:00:00.000Z",
          syncStatus: "applied",
        },
        {
          clientEventId: "event-correction-rejected",
          snapshotId: saved.snapshotId,
          snapshotSavedAt: saved.savedAt,
          tripId: "trip-1",
          bookingId: "ready",
          checkpoint: "after_dive_1",
          status: "boarded",
          note: null,
          occurredAt: "2026-07-20T14:05:00.000Z",
          syncStatus: "rejected",
        },
      ],
      "ready",
      "after_dive_1",
    );
    expect(latest).toEqual({
      state: "not_boarded",
      occurredAt: "2026-07-20T14:00:00.000Z",
      pending: false,
      implied: false,
      local: true,
      // The rescued event, not the rejected one on top of it: a retraction
      // aimed at this row would name the mark the crew can actually see.
      clientEventId: "event-missing",
    });
  });

  /**
   * The device side of a refused compare-and-set (ADR
   * 20260815-an-offline-retraction-names-its-target), and the reason refusing is
   * safe rather than merely conservative-sounding.
   *
   * The crew tapped undo on their own mark; the server refused, because a second
   * device had said something about that diver since. That refusal has to leave
   * the loudest row the product has *on the screen the crew is holding* — a
   * retraction that comes back rejected and takes the alarm with it would be the
   * same silence ADR 20260815-a-rejected-correction-may-not-silence-a-missing-diver
   * exists to prevent, reached by a different door.
   *
   * The alarm survives on the rescue that was already there. What the refusal
   * *changes* is what the row then says about itself: it stops claiming to be
   * this device's own statement (`local`) and stops naming an event to retract
   * (`clientEventId`), because the server has just said in so many words that
   * the statement standing is somebody else's. Without that the row keeps
   * offering "Tap 'Not back aboard' again to undo" and every tap queues another
   * retraction the server refuses identically — an undo that can never succeed,
   * under copy promising it will (dive-domain review, 2026-08-15). A crew that
   * taps the loudest row's undo three times into silence is a crew that stops
   * trusting the control.
   */
  it("keeps the alarm on screen when a retraction of it is refused, and stops offering that undo", () => {
    const saved = snapshot();
    const alarm = {
      clientEventId: "event-missing",
      snapshotId: saved.snapshotId,
      snapshotSavedAt: saved.savedAt,
      tripId: "trip-1",
      bookingId: "ready",
      checkpoint: "after_dive_1" as const,
      status: "not_boarded" as const,
      note: null,
      occurredAt: "2026-07-20T14:00:00.000Z",
      syncStatus: "applied" as const,
    };
    const refusedRetraction = {
      ...alarm,
      clientEventId: "event-undo",
      status: "cleared" as const,
      retractsClientEventId: "event-missing",
      occurredAt: "2026-07-20T14:05:00.000Z",
      syncStatus: "rejected" as const,
      rejectionReason: "retraction_superseded",
    };
    expect(
      latestOfflineRollCall(saved, [alarm, refusedRetraction], "ready", "after_dive_1"),
    ).toEqual({
      state: "not_boarded",
      occurredAt: "2026-07-20T14:00:00.000Z",
      pending: false,
      implied: false,
      // Not `local` any more, which is what switches the line under the row to
      // "Recorded on another device or on the live manifest — undo it there,
      // not here." That sentence is now literally true.
      local: false,
      clientEventId: undefined,
    });
    // The crew half of the same composition, because the two halves of one head
    // count must not disagree about whether somebody is still in the water.
    const crewSaved = crewSnapshot();
    const crewAlarm = {
      ...alarm,
      snapshotId: crewSaved.snapshotId,
      snapshotSavedAt: crewSaved.savedAt,
      bookingId: undefined,
      crewPersonId: "crew-dana",
    };
    const crewRefused = {
      ...crewAlarm,
      clientEventId: "event-crew-undo",
      status: "cleared" as const,
      retractsClientEventId: "event-missing",
      occurredAt: "2026-07-20T14:05:00.000Z",
      syncStatus: "rejected" as const,
      rejectionReason: "retraction_superseded",
    };
    expect(
      latestOfflineCrewRollCall(crewSaved, [crewAlarm, crewRefused], "crew-dana", "after_dive_1"),
    ).toMatchObject({ state: "not_boarded", local: false, clientEventId: undefined });
  });

  /**
   * The refusal at **`departure`**, where it is a different act (dive-domain
   * review, 2026-08-15). After a dive `not_boarded` means *did not come back*
   * and holding it keeps a count open. At the dock it means *never left*, which
   * is **accounted for** and carries forward to every later checkpoint — so a
   * refusal that leaves the dock mark standing does not hold one count open, it
   * closes three.
   *
   * The sequence, with no malice and no bug in any step: the tablet marks Priya
   * ashore at the dock and syncs it; Priya turns up late and the desk boards her
   * on the live manifest; the crew tap to take their mark back; the server
   * refuses, correctly, because the desk's sighting is what stands. Left there,
   * this device would read Priya "not boarded · carried" after dive 1 and print
   * roll call complete — about somebody who is in the water.
   *
   * So a `retraction_superseded` refusal reads the row down to **awaiting**
   * wherever the value it would otherwise leave standing is not itself an alarm.
   * Awaiting is the fail-open answer (ADR
   * 20260815-a-rejected-correction-may-not-silence-a-missing-diver's own
   * reasoning, one door along): the count stays open, the crew are asked again,
   * and nothing on this copy claims a person is accounted for on the strength of
   * a statement the server has moved past.
   */
  it("reads a superseded dock retraction down to awaiting, so nothing carries forward", () => {
    const saved = snapshot();
    // The snapshot came home carrying this device's own dock mark, which is
    // exactly the value the server has since moved past.
    for (const manifest of saved.manifests) {
      const diver = manifest.divers.find((entry) => entry.bookingId === "ready");
      if (!diver) throw new Error("fixture lost a diver");
      diver.rollCall =
        manifest.checkpoint === "departure"
          ? {
              state: "not_boarded",
              occurredAt: "2026-07-20T11:30:00.000Z",
              recordedByName: "Dana Divemaster",
              note: null,
            }
          : undefined;
    }
    const dock = {
      clientEventId: "event-dock",
      snapshotId: saved.snapshotId,
      snapshotSavedAt: saved.savedAt,
      tripId: "trip-1",
      bookingId: "ready",
      checkpoint: "departure" as const,
      status: "not_boarded" as const,
      note: null,
      occurredAt: "2026-07-20T11:30:00.000Z",
      syncStatus: "applied" as const,
    };
    const refused = {
      ...dock,
      clientEventId: "event-dock-undo",
      status: "cleared" as const,
      retractsClientEventId: "event-dock",
      occurredAt: "2026-07-20T11:45:00.000Z",
      syncStatus: "rejected" as const,
      rejectionReason: "retraction_superseded",
    };
    const events = [dock, refused];
    expect(latestOfflineRollCall(saved, events, "ready", "departure")).toBeUndefined();
    // And nothing carries: the after-dive checkpoints stay open rather than
    // reading "ashore, accounted for" about a diver who is aboard.
    expect(latestOfflineRollCall(saved, events, "ready", "after_dive_1")).toBeUndefined();
    expect(latestOfflineRollCall(saved, events, "ready", "after_dive_2")).toBeUndefined();

    // Crew are read down the same way, through the same function.
    const crewSaved = crewSnapshot();
    const crewEvents = events.map((event) => ({
      ...event,
      bookingId: undefined,
      crewPersonId: "crew-dana",
      snapshotId: crewSaved.snapshotId,
      snapshotSavedAt: crewSaved.savedAt,
    }));
    expect(
      latestOfflineCrewRollCall(crewSaved, crewEvents, "crew-dana", "departure"),
    ).toBeUndefined();
    expect(
      latestOfflineCrewRollCall(crewSaved, crewEvents, "crew-dana", "after_dive_1"),
    ).toBeUndefined();
  });

  /**
   * The one direction the rule above may never run. A refusal reads a row down
   * to awaiting because awaiting is fail-open — but a stated "did not come back"
   * is the one value where *silence is the failure*, so it stands regardless of
   * where it came from. Here the snapshot holds the alarm and this device has no
   * local event to rescue; the refusal must leave the alarm exactly where it is.
   */
  it("never reads an alarm down to awaiting, whoever recorded it", () => {
    const saved = snapshot();
    const afterDive = saved.manifests.find((manifest) => manifest.checkpoint === "after_dive_1");
    const diver = afterDive?.divers.find((entry) => entry.bookingId === "ready");
    if (!diver) throw new Error("fixture lost a diver");
    diver.rollCall = {
      state: "not_boarded",
      occurredAt: "2026-07-20T14:20:00.000Z",
      recordedByName: "Sal Ortiz",
      note: null,
    };
    const refused = {
      clientEventId: "event-undo",
      snapshotId: saved.snapshotId,
      snapshotSavedAt: saved.savedAt,
      tripId: "trip-1",
      bookingId: "ready",
      checkpoint: "after_dive_1" as const,
      status: "cleared" as const,
      retractsClientEventId: "event-somebody-elses",
      note: null,
      occurredAt: "2026-07-20T14:30:00.000Z",
      syncStatus: "rejected" as const,
      rejectionReason: "retraction_superseded",
    };
    expect(latestOfflineRollCall(saved, [refused], "ready", "after_dive_1")).toMatchObject({
      state: "not_boarded",
      local: false,
    });
  });

  // And the asymmetry is exactly that: it may never run the other way. An
  // applied "boarded" under a rejected "not_boarded" is the stale optimism the
  // snapshot fallback exists to overrule, after a dive as much as at the dock.
  it("never resurrects a superseded boarded when the correction is rejected after a dive", () => {
    const saved = snapshot();
    const latest = latestOfflineRollCall(
      saved,
      [
        {
          clientEventId: "event-optimistic",
          snapshotId: saved.snapshotId,
          snapshotSavedAt: saved.savedAt,
          tripId: "trip-1",
          bookingId: "ready",
          checkpoint: "after_dive_1",
          status: "boarded",
          note: null,
          occurredAt: "2026-07-20T14:00:00.000Z",
          syncStatus: "applied",
        },
        {
          clientEventId: "event-alarm-rejected",
          snapshotId: saved.snapshotId,
          snapshotSavedAt: saved.savedAt,
          tripId: "trip-1",
          bookingId: "ready",
          checkpoint: "after_dive_1",
          status: "not_boarded",
          note: null,
          occurredAt: "2026-07-20T14:05:00.000Z",
          syncStatus: "rejected",
        },
      ],
      "ready",
      "after_dive_1",
    );
    expect(latest).toBeUndefined();
  });

  /*
   * And the bound on that rescue: it outranks the snapshot's *silence*, never
   * a later sighting (dive-domain review, 2026-08-15). The two-device boat is
   * the one big enough to need offline manifests — a second crew member
   * records the diver back aboard on the live manifest, this device's next
   * auto-save brings that home, and a rejection here must not re-raise an
   * alarm the server has since settled.
   */
  it("does not re-raise an alarm the snapshot has since answered with a later sighting", () => {
    const saved = snapshot();
    const afterDive1 = saved.manifests.find((manifest) => manifest.checkpoint === "after_dive_1");
    const diver = afterDive1?.divers.find((entry) => entry.bookingId === "ready");
    if (!diver) throw new Error("fixture lost a diver");
    diver.rollCall = {
      state: "boarded",
      occurredAt: "2026-07-20T14:03:00.000Z",
      recordedByName: "Sal Ortiz",
      note: null,
    };
    const latest = latestOfflineRollCall(
      saved,
      [
        {
          clientEventId: "event-earlier-alarm",
          snapshotId: saved.snapshotId,
          snapshotSavedAt: saved.savedAt,
          tripId: "trip-1",
          bookingId: "ready",
          checkpoint: "after_dive_1",
          status: "not_boarded",
          note: null,
          occurredAt: "2026-07-20T14:00:00.000Z",
          syncStatus: "applied",
        },
        {
          clientEventId: "event-later-rejected",
          snapshotId: saved.snapshotId,
          snapshotSavedAt: saved.savedAt,
          tripId: "trip-1",
          bookingId: "ready",
          checkpoint: "after_dive_1",
          status: "boarded",
          note: null,
          occurredAt: "2026-07-20T14:05:00.000Z",
          syncStatus: "rejected",
        },
      ],
      "ready",
      "after_dive_1",
    );
    expect(latest).toEqual({
      state: "boarded",
      occurredAt: "2026-07-20T14:03:00.000Z",
      pending: false,
      implied: false,
      local: false,
    });
  });

  // At `departure` the rule stays symmetric, deliberately (same ADR). A
  // `not_boarded` recorded at the dock means "never got on the boat" — benign,
  // accounted for, and carried forward — so there is no alarm for a rejection
  // to silence, and preferring a superseded local event there would re-assert
  // stale optimism against the one checkpoint where the server's refusal is
  // most likely to be a readiness fact this device cannot see.
  it("still falls back to the snapshot at departure, where not boarded is not an alarm", () => {
    const saved = snapshot();
    const latest = latestOfflineRollCall(
      saved,
      [
        {
          clientEventId: "event-dock-ashore",
          snapshotId: saved.snapshotId,
          snapshotSavedAt: saved.savedAt,
          tripId: "trip-1",
          bookingId: "ready",
          checkpoint: "departure",
          status: "not_boarded",
          note: null,
          occurredAt: "2026-07-20T11:00:00.000Z",
          syncStatus: "applied",
        },
        {
          clientEventId: "event-dock-rejected",
          snapshotId: saved.snapshotId,
          snapshotSavedAt: saved.savedAt,
          tripId: "trip-1",
          bookingId: "ready",
          checkpoint: "departure",
          status: "boarded",
          note: null,
          occurredAt: "2026-07-20T11:10:00.000Z",
          syncStatus: "rejected",
        },
      ],
      "ready",
      "departure",
    );
    expect(latest).toBeUndefined();
  });

  /*
   * Carry-forward on the device (ADR 20260815-offline-carry-forward-and-roll-
   * call-sequence). A diver marked ashore at the dock with no signal used to
   * read *awaiting* at every later checkpoint on that device, where online
   * they read "not boarded · carried" — and the only control that would take a
   * result for them after a dive is "Mark not back aboard", which writes a
   * genuine missing-diver event about somebody in the car park.
   */
  it("carries a device-recorded departure not-boarded forward to a later checkpoint", () => {
    const saved = snapshot();
    const events = [
      {
        clientEventId: "event-dock",
        snapshotId: saved.snapshotId,
        snapshotSavedAt: saved.savedAt,
        tripId: "trip-1",
        bookingId: "ready",
        checkpoint: "departure" as const,
        status: "not_boarded" as const,
        note: null,
        occurredAt: "2026-07-20T11:30:00.000Z",
        syncStatus: "applied" as const,
      },
    ];
    expect(latestOfflineRollCall(saved, events, "ready", "departure")).toEqual({
      state: "not_boarded",
      occurredAt: "2026-07-20T11:30:00.000Z",
      pending: false,
      implied: false,
      local: true,
      clientEventId: "event-dock",
    });
    // The carried copies name the dock event too, and that is inert rather than
    // a licence: `rollCallRowState`'s `recordedNotBoarded` is false for an
    // `implied` result, so no control offers a retraction here — and one aimed
    // here anyway would be refused by the server, whose newest-event lookup is
    // scoped to *this* checkpoint, where the dock event is not.
    expect(latestOfflineRollCall(saved, events, "ready", "after_dive_1")).toEqual({
      state: "not_boarded",
      occurredAt: "2026-07-20T11:30:00.000Z",
      pending: false,
      implied: true,
      local: true,
      clientEventId: "event-dock",
    });
    expect(latestOfflineRollCall(saved, events, "ready", "after_dive_2")).toEqual({
      state: "not_boarded",
      occurredAt: "2026-07-20T11:30:00.000Z",
      pending: false,
      implied: true,
      local: true,
      clientEventId: "event-dock",
    });
  });

  // The interaction with what the snapshot already baked in, and the direction
  // that matters: an explicit result on this device breaks the chain the
  // *server* carried, so the later checkpoints reopen rather than reading a
  // stale "ashore, accounted for" about somebody who is now in the water.
  it("stops carrying when the device says the diver boarded at departure after all", () => {
    const saved = snapshot();
    for (const manifest of saved.manifests) {
      const diver = manifest.divers.find((entry) => entry.bookingId === "ready");
      if (!diver) throw new Error("fixture lost a diver");
      diver.rollCall = {
        state: "not_boarded",
        occurredAt: "2026-07-20T11:02:00.000Z",
        recordedByName: "Dana Divemaster",
        note: null,
        implied: manifest.checkpoint !== "departure",
      };
    }
    const events = [
      {
        clientEventId: "event-made-it",
        snapshotId: saved.snapshotId,
        snapshotSavedAt: saved.savedAt,
        tripId: "trip-1",
        bookingId: "ready",
        checkpoint: "departure" as const,
        status: "boarded" as const,
        note: null,
        occurredAt: "2026-07-20T11:40:00.000Z",
        syncStatus: "pending" as const,
      },
    ];
    expect(latestOfflineRollCall(saved, events, "ready", "departure")?.state).toBe("boarded");
    expect(latestOfflineRollCall(saved, events, "ready", "after_dive_1")).toBeUndefined();
  });

  /*
   * The retraction (ADR 20260815-offline-can-unsay-a-missing-diver). A
   * `cleared` event returns the row to awaiting, exactly as it does on the
   * live manifest — and must not fall through to the snapshot's own stale
   * result, which would make the undo a no-op.
   */
  it("returns a row to awaiting when the latest device event is a retraction", () => {
    const saved = snapshot();
    const afterDive1 = saved.manifests.find((manifest) => manifest.checkpoint === "after_dive_1");
    const diver = afterDive1?.divers.find((entry) => entry.bookingId === "ready");
    if (!diver) throw new Error("fixture lost a diver");
    diver.rollCall = {
      state: "not_boarded",
      occurredAt: "2026-07-20T14:00:00.000Z",
      recordedByName: "Dana Divemaster",
      note: null,
    };
    const events = [
      {
        clientEventId: "event-mistap",
        snapshotId: saved.snapshotId,
        snapshotSavedAt: saved.savedAt,
        tripId: "trip-1",
        bookingId: "ready",
        checkpoint: "after_dive_1" as const,
        status: "not_boarded" as const,
        note: null,
        occurredAt: "2026-07-20T14:10:00.000Z",
        syncStatus: "applied" as const,
      },
      {
        clientEventId: "event-retraction",
        snapshotId: saved.snapshotId,
        snapshotSavedAt: saved.savedAt,
        tripId: "trip-1",
        bookingId: "ready",
        checkpoint: "after_dive_1" as const,
        status: "cleared" as const,
        note: null,
        occurredAt: "2026-07-20T14:11:00.000Z",
        syncStatus: "pending" as const,
      },
    ];
    expect(latestOfflineRollCall(saved, events, "ready", "after_dive_1")).toBeUndefined();
  });

  // A retraction is never refused: it takes nobody onto a boat, and a crew
  // that cannot unsay a mis-tap stops tapping the control at all.
  it("allows a retraction for anyone on the copy, at any checkpoint", () => {
    const saved = snapshot();
    expect(canRecordOfflineStatus(saved, "blocked", "cleared", "departure")).toBe(true);
    expect(canRecordOfflineStatus(saved, "ready", "cleared", "after_dive_3")).toBe(true);
    // Still nobody, though — an id this copy has never heard of names no one.
    expect(canRecordOfflineStatus(saved, "missing", "cleared", "departure")).toBe(false);
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
      local: false,
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
      {
        slug: "blue-mantis",
        name: "Blue Mantis",
        timezone: "America/New_York",
        emergencyReference: EMPTY_EMERGENCY_REFERENCE,
      },
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
      {
        slug: "blue-mantis",
        name: "Blue Mantis",
        timezone: "America/New_York",
        emergencyReference: EMPTY_EMERGENCY_REFERENCE,
      },
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
      {
        slug: "blue-mantis",
        name: "Blue Mantis",
        timezone: "America/New_York",
        emergencyReference: EMPTY_EMERGENCY_REFERENCE,
      },
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
      local: true,
      clientEventId: "event-crew",
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
      local: false,
    });
  });

  // The crew half of the asymmetry, and it is the same rule read through the
  // same helper: a rejected correction may not demote a divemaster who a
  // non-rejected local event says did not come back — here the snapshot holds
  // nothing for her, which is exactly when the old fallback went quiet.
  it("keeps a crew member's not-back-aboard on screen when the correction is rejected", () => {
    const saved = crewSnapshot();
    const events = [
      {
        clientEventId: "event-crew-missing",
        snapshotId: saved.snapshotId,
        snapshotSavedAt: saved.savedAt,
        tripId: "trip-1",
        crewPersonId: "crew-dana",
        checkpoint: "after_dive_1" as const,
        status: "not_boarded" as const,
        note: null,
        occurredAt: "2026-07-20T14:05:00.000Z",
        syncStatus: "applied" as const,
      },
      {
        clientEventId: "event-crew-correction",
        snapshotId: saved.snapshotId,
        snapshotSavedAt: saved.savedAt,
        tripId: "trip-1",
        crewPersonId: "crew-dana",
        checkpoint: "after_dive_1" as const,
        status: "boarded" as const,
        note: null,
        occurredAt: "2026-07-20T14:06:00.000Z",
        syncStatus: "rejected" as const,
      },
    ];
    expect(latestOfflineCrewRollCall(saved, events, "crew-dana", "after_dive_1")).toEqual({
      state: "not_boarded",
      occurredAt: "2026-07-20T14:05:00.000Z",
      pending: false,
      implied: false,
      local: true,
      // The rescued mark, so the crew half names its target exactly as the
      // diver half does.
      clientEventId: "event-crew-missing",
    });
  });

  it("carries a crew member's dock not-boarded forward, and lets a retraction undo it", () => {
    const saved = crewSnapshot();
    const ashore = {
      clientEventId: "event-crew-dock",
      snapshotId: saved.snapshotId,
      snapshotSavedAt: saved.savedAt,
      tripId: "trip-1",
      crewPersonId: "crew-dana",
      checkpoint: "departure" as const,
      status: "not_boarded" as const,
      note: null,
      occurredAt: "2026-07-20T11:30:00.000Z",
      syncStatus: "applied" as const,
    };
    expect(latestOfflineCrewRollCall(saved, [ashore], "crew-dana", "after_dive_1")).toEqual({
      state: "not_boarded",
      occurredAt: "2026-07-20T11:30:00.000Z",
      pending: false,
      implied: true,
      local: true,
      clientEventId: "event-crew-dock",
    });
    const retraction = {
      ...ashore,
      clientEventId: "event-crew-retraction",
      status: "cleared" as const,
      occurredAt: "2026-07-20T11:31:00.000Z",
      syncStatus: "pending" as const,
    };
    // The whole chain reverts: nothing was said at the dock after all, so
    // nothing carries, and every later checkpoint reads awaiting again.
    expect(
      latestOfflineCrewRollCall(saved, [ashore, retraction], "crew-dana", "departure"),
    ).toBeUndefined();
    expect(
      latestOfflineCrewRollCall(saved, [ashore, retraction], "crew-dana", "after_dive_1"),
    ).toBeUndefined();
    expect(canRecordOfflineCrewStatus(saved, "crew-dana", "cleared", "after_dive_1")).toBe(true);
    expect(canRecordOfflineCrewStatus(saved, "nobody", "cleared", "after_dive_1")).toBe(false);
  });

  /*
   * Two taps at one timestamp, on both halves of one head count.
   *
   * `occurredAt` is millisecond-resolution, so in production two deliberate taps
   * landing on the same value is close to unreachable. In the e2e fleet it is
   * the *normal* case: the clock is frozen so visual baselines stay pixel-stable
   * (AGENTS.md's clock rule), which means every offline event for one subject in
   * every test shares one timestamp. That is how this surfaced.
   *
   * The rule these pin is insertion order — the later-queued event wins —
   * because that is what the SERVER already does with an equal timestamp:
   * `recordRollCall`/`recordCrewRollCall` refuse an offline event only when
   * `newest.occurredAt > occurredAt`, so an equal one is accepted, and the read
   * back orders by `desc(occurredAt), desc(createdAt)`. A device that kept the
   * older tap disagreed with the server about the same two events.
   */
  it("keeps the later-queued result when two crew taps share a timestamp", () => {
    const saved = crewSnapshot();
    const base = {
      snapshotId: saved.snapshotId,
      snapshotSavedAt: saved.savedAt,
      tripId: "trip-1",
      crewPersonId: "crew-dana",
      checkpoint: "after_dive_1" as const,
      note: null,
      // The correction and the mistake are indistinguishable by time.
      occurredAt: "2026-07-20T14:05:00.000Z",
      syncStatus: "pending" as const,
    };
    // A captain marks the wrong row, sees it, and fixes it in the same
    // millisecond. The screen must show the fix, not the mistake.
    const events = [
      { ...base, clientEventId: "event-mistake", status: "not_boarded" as const },
      { ...base, clientEventId: "event-correction", status: "boarded" as const },
    ];

    expect(latestOfflineCrewRollCall(saved, events, "crew-dana", "after_dive_1")?.state).toBe(
      "boarded",
    );
    // ...and it is the ORDER that decides, not the status: the same two events
    // queued the other way round read the other way round.
    expect(
      latestOfflineCrewRollCall(saved, [events[1], events[0]], "crew-dana", "after_dive_1")?.state,
    ).toBe("not_boarded");
  });

  it("keeps the later-queued result when two diver taps share a timestamp", () => {
    const saved = crewSnapshot();
    const base = {
      snapshotId: saved.snapshotId,
      snapshotSavedAt: saved.savedAt,
      tripId: "trip-1",
      bookingId: "ready",
      checkpoint: "after_dive_1" as const,
      note: null,
      occurredAt: "2026-07-20T14:05:00.000Z",
      syncStatus: "pending" as const,
    };
    const events = [
      { ...base, clientEventId: "event-mistake", status: "not_boarded" as const },
      { ...base, clientEventId: "event-correction", status: "boarded" as const },
    ];

    expect(latestOfflineRollCall(saved, events, "ready", "after_dive_1")?.state).toBe("boarded");
    expect(
      latestOfflineRollCall(saved, [events[1], events[0]], "ready", "after_dive_1")?.state,
    ).toBe("not_boarded");
  });

  it("keeps the last of three results that all share a timestamp", () => {
    const saved = crewSnapshot();
    const base = {
      snapshotId: saved.snapshotId,
      snapshotSavedAt: saved.savedAt,
      tripId: "trip-1",
      crewPersonId: "crew-dana",
      checkpoint: "after_dive_1" as const,
      note: null,
      occurredAt: "2026-07-20T14:05:00.000Z",
      syncStatus: "pending" as const,
    };
    // Three taps, not two: "later-queued wins" has to be transitively the LAST
    // one, not whichever end of the list a comparison happens to favour.
    const events = [
      { ...base, clientEventId: "event-1", status: "not_boarded" as const },
      { ...base, clientEventId: "event-2", status: "boarded" as const },
      { ...base, clientEventId: "event-3", status: "not_boarded" as const },
    ];

    expect(latestOfflineCrewRollCall(saved, events, "crew-dana", "after_dive_1")?.state).toBe(
      "not_boarded",
    );
    expect(
      latestOfflineCrewRollCall(saved, events.slice(0, 2), "crew-dana", "after_dive_1")?.state,
    ).toBe("boarded");
  });

  /*
   * A stored event naming BOTH a booking and a crew person is refused on the
   * way in twice over — by `appendOfflineRollCall` and by the sync route's
   * schema — but a record already in IndexedDB is a cast, not a parse, and
   * neither of those can vouch for what is already on the device. Matching on
   * one field alone would let a single such event be counted by both readers:
   * one tap, two people marked.
   */
  it("counts an event naming both subjects for neither of them", () => {
    const saved = crewSnapshot();
    const confused = {
      clientEventId: "event-both",
      snapshotId: saved.snapshotId,
      snapshotSavedAt: saved.savedAt,
      tripId: "trip-1",
      bookingId: "ready",
      crewPersonId: "crew-dana",
      checkpoint: "after_dive_1" as const,
      status: "boarded" as const,
      note: null,
      occurredAt: "2026-07-20T14:05:00.000Z",
      syncStatus: "pending" as const,
    };

    expect(
      latestOfflineCrewRollCall(saved, [confused], "crew-dana", "after_dive_1"),
    ).toBeUndefined();
    expect(latestOfflineRollCall(saved, [confused], "ready", "after_dive_1")).toBeUndefined();
  });

  it("still prefers a genuinely newer timestamp over queue position", () => {
    const saved = crewSnapshot();
    const base = {
      snapshotId: saved.snapshotId,
      snapshotSavedAt: saved.savedAt,
      tripId: "trip-1",
      crewPersonId: "crew-dana",
      checkpoint: "after_dive_1" as const,
      note: null,
      syncStatus: "pending" as const,
    };
    // Queued newest-first, which a resync or a merge can produce. Time still
    // wins; insertion order only breaks a tie.
    const events = [
      {
        ...base,
        clientEventId: "event-newer",
        status: "boarded" as const,
        occurredAt: "2026-07-20T14:09:00.000Z",
      },
      {
        ...base,
        clientEventId: "event-older",
        status: "not_boarded" as const,
        occurredAt: "2026-07-20T14:05:00.000Z",
      },
    ];

    expect(latestOfflineCrewRollCall(saved, events, "crew-dana", "after_dive_1")).toEqual({
      state: "boarded",
      occurredAt: "2026-07-20T14:09:00.000Z",
      pending: true,
      implied: false,
      local: true,
      clientEventId: "event-newer",
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
