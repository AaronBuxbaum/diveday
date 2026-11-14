import { expect, it } from "vitest";
import { crewSnapshot } from "@/test/substrate-fixtures/lib/offline-manifests-fixtures";
import {
  latestOfflineCrewRollCall,
  latestOfflineRollCall,
  type OfflineRollCallEvent,
} from "./offline-manifests";
import { offlineCausalContext, offlineReviewReasons } from "./roll-call-offline-causality";

it("requires a shaped matching proof before treating a pending same-copy meeting as known", () => {
  const snapshot = crewSnapshot();
  const tag = "a".repeat(43);
  const id = "33333333-3333-4333-8333-333333333333";
  const proof = `${id}.0.a.b.0.${tag}`;
  snapshot.rollCallMeetingDays = [
    {
      startsAt: "2026-08-01T10:00:00Z",
      endsAt: "2026-08-01T11:00:00Z",
      meetingIdentityProof: proof,
    },
  ];
  const event: OfflineRollCallEvent = {
    clientEventId: crypto.randomUUID(),
    snapshotId: snapshot.snapshotId,
    snapshotSavedAt: snapshot.savedAt,
    tripId: snapshot.manifests[0].trip.id,
    bookingId: snapshot.manifests[0].divers[0].bookingId,
    checkpoint: "departure",
    status: "boarded",
    meetingDay: 0,
    occurredAt: snapshot.savedAt,
    syncStatus: "pending",
  };
  for (const token of [
    undefined,
    `${id}.0.a.b.${tag}`,
    `bad.0.a.b.0.${tag}`,
    `${id}.1.a.b.0.${tag}`,
    `${id}.0.b.a.0.${tag}`,
    `${id}.0.a.b.0.short`,
    `${id}.0.a.b.0.${"b".repeat(43)}`,
  ]) {
    expect(
      offlineReviewReasons(snapshot, [{ ...event, meetingIdentityProof: token }]).get(
        event.clientEventId,
      ),
    ).toBe("meeting_identity_unverified");
  }
  expect(
    offlineReviewReasons(snapshot, [{ ...event, meetingIdentityProof: proof }]).has(
      event.clientEventId,
    ),
  ).toBe(false);
});

it("keeps a queued observation unconfirmed when a later copy has a new schedule generation", () => {
  const snapshot = crewSnapshot();
  const id = "33333333-3333-4333-8333-333333333333";
  const tag = "a".repeat(43);
  snapshot.rollCallMeetingDays = [
    {
      startsAt: "2026-08-01T10:00:00Z",
      endsAt: "2026-08-01T11:00:00Z",
      meetingIdentityProof: `${id}.0.a.b.1.${tag}`,
    },
  ];
  const event: OfflineRollCallEvent = {
    clientEventId: crypto.randomUUID(),
    snapshotId: crypto.randomUUID(),
    snapshotSavedAt: snapshot.savedAt,
    tripId: snapshot.manifests[0].trip.id,
    bookingId: snapshot.manifests[0].divers[0].bookingId,
    checkpoint: "departure",
    status: "boarded",
    meetingDay: 0,
    occurredAt: snapshot.savedAt,
    syncStatus: "pending",
    meetingIdentityProof: `${id}.0.a.b.0.${tag}`,
  };
  expect(offlineReviewReasons(snapshot, [event]).get(event.clientEventId)).toBe(
    "meeting_identity_unverified",
  );
  expect(event.syncStatus).toBe("pending");
});

it("propagates unresolved status through a reversed chain without blocking an independent tap", () => {
  const snapshot = crewSnapshot();
  const proof = `33333333-3333-4333-8333-333333333333.0.a.b.0.${"a".repeat(43)}`;
  snapshot.rollCallMeetingDays = [
    {
      startsAt: "2026-08-01T10:00:00Z",
      endsAt: "2026-08-01T11:00:00Z",
      meetingIdentityProof: proof,
    },
  ];
  const first: OfflineRollCallEvent = {
    clientEventId: crypto.randomUUID(),
    snapshotId: snapshot.snapshotId,
    snapshotSavedAt: snapshot.savedAt,
    tripId: snapshot.manifests[0].trip.id,
    bookingId: snapshot.manifests[0].divers[0].bookingId,
    checkpoint: "departure",
    status: "boarded",
    meetingDay: 0,
    occurredAt: snapshot.savedAt,
    syncStatus: "pending",
  };
  const chain = [first];
  for (let i = 1; i < 200; i += 1)
    chain.push({
      ...first,
      clientEventId: crypto.randomUUID(),
      meetingIdentityProof: proof,
      observedEvidenceIds: [`client:${chain[i - 1].clientEventId}`],
    });
  const independent = { ...first, clientEventId: crypto.randomUUID(), meetingIdentityProof: proof };
  const reasons = offlineReviewReasons(snapshot, [...chain].reverse().concat(independent));
  expect(reasons.size).toBe(200);
  expect(reasons.get(first.clientEventId)).toBe("meeting_identity_unverified");
  expect(reasons.get(chain[199].clientEventId)).toBe("unresolved_predecessor");
  expect(reasons.has(independent.clientEventId)).toBe(false);
});

it("does not attach a pending mark to a newly inserted meeting at its old ordinal", () => {
  const snapshot = crewSnapshot();
  const bookingId = snapshot.manifests[0].divers[0].bookingId;
  snapshot.rollCallMeetingDays = [
    {
      startsAt: "2026-08-01T10:00:00Z",
      endsAt: "2026-08-01T11:00:00Z",
      meetingIdentityProof:
        "11111111-1111-4111-8111-111111111111.0.a.b.0.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    {
      startsAt: "2026-08-02T10:00:00Z",
      endsAt: "2026-08-02T11:00:00Z",
      meetingIdentityProof:
        "44444444-4444-4444-8444-444444444444.1.c.d.0.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  ];
  snapshot.selectedRollCallMeetingDay = 1;
  const event: OfflineRollCallEvent = {
    clientEventId: crypto.randomUUID(),
    snapshotId: crypto.randomUUID(),
    snapshotSavedAt: snapshot.savedAt,
    tripId: snapshot.manifests[0].trip.id,
    bookingId,
    checkpoint: "departure",
    status: "boarded",
    meetingDay: 1,
    meetingIdentityProof:
      "55555555-5555-4555-8555-555555555555.1.e.f.0.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    occurredAt: snapshot.savedAt,
    syncStatus: "pending",
  };
  const context = offlineCausalContext(snapshot, [event], { bookingId }, "departure");
  expect(context.observedEvidenceIds).not.toContain(`client:${event.clientEventId}`);
  expect(latestOfflineRollCall(snapshot, [event], bookingId, "departure")?.state).not.toBe(
    "boarded",
  );
});

it("keeps a pending mark on the same meeting across a fresh snapshot", () => {
  const snapshot = crewSnapshot();
  const bookingId = snapshot.manifests[0].divers[0].bookingId;
  snapshot.rollCallMeetingDays = [
    {
      startsAt: "2026-08-01T10:00:00Z",
      endsAt: "2026-08-01T11:00:00Z",
      meetingIdentityProof:
        "33333333-3333-4333-8333-333333333333.0.a.b.0.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  ];
  const event: OfflineRollCallEvent = {
    clientEventId: crypto.randomUUID(),
    snapshotId: crypto.randomUUID(),
    snapshotSavedAt: snapshot.savedAt,
    tripId: snapshot.manifests[0].trip.id,
    bookingId,
    checkpoint: "departure",
    status: "boarded",
    meetingDay: 0,
    meetingIdentityProof:
      "33333333-3333-4333-8333-333333333333.0.a.b.0.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    occurredAt: snapshot.savedAt,
    syncStatus: "pending",
  };
  expect(latestOfflineRollCall(snapshot, [event], bookingId, "departure")?.state).toBe("boarded");
});

it("does not let an unresolved correction hide an unresolved missing report", () => {
  const snapshot = crewSnapshot();
  const manifest = snapshot.manifests[0];
  manifest.checkpoint = "after_dive_1";
  const bookingId = manifest.divers[0].bookingId;
  snapshot.rollCallMeetingDays = [
    {
      startsAt: "2026-08-01T10:00:00Z",
      endsAt: "2026-08-01T11:00:00Z",
      meetingIdentityProof:
        "11111111-1111-4111-8111-111111111111.0.a.b.0.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  ];
  const missing: OfflineRollCallEvent = {
    clientEventId: crypto.randomUUID(),
    snapshotId: crypto.randomUUID(),
    snapshotSavedAt: snapshot.savedAt,
    tripId: manifest.trip.id,
    bookingId,
    checkpoint: "after_dive_1",
    status: "not_boarded",
    meetingDay: 0,
    occurredAt: snapshot.savedAt,
    syncStatus: "pending",
    unresolvedReason: "meeting_identity_unverified",
  };
  const correction: OfflineRollCallEvent = {
    ...missing,
    clientEventId: crypto.randomUUID(),
    snapshotId: snapshot.snapshotId,
    status: "boarded",
    unresolvedReason: "unresolved_predecessor",
    observedEvidenceIds: [`client:${missing.clientEventId}`],
  };
  expect(
    latestOfflineRollCall(snapshot, [missing, correction], bookingId, "after_dive_1")?.state,
  ).toBe("not_boarded");
  const unsentCorrection = { ...correction, unresolvedReason: undefined };
  expect(
    latestOfflineRollCall(snapshot, [missing, unsentCorrection], bookingId, "after_dive_1")?.state,
  ).toBe("not_boarded");
  const beforeAnyReply = { ...missing, unresolvedReason: undefined };
  expect(
    latestOfflineRollCall(snapshot, [beforeAnyReply, unsentCorrection], bookingId, "after_dive_1")
      ?.state,
  ).toBe("not_boarded");
  const legacyMissing = {
    ...beforeAnyReply,
    snapshotId: snapshot.snapshotId,
    meetingIdentityProof: undefined,
  };
  const legacyCorrection = {
    ...unsentCorrection,
    snapshotId: snapshot.snapshotId,
    meetingIdentityProof: undefined,
  };
  expect(
    latestOfflineRollCall(snapshot, [legacyMissing, legacyCorrection], bookingId, "after_dive_1")
      ?.state,
  ).toBe("not_boarded");
  snapshot.rollCallDayBoundaries = ["2026-08-02T00:00:00Z"];
  snapshot.selectedRollCallMeetingDay = 1;
  const legacyDayTwo = { ...legacyMissing, meetingDay: 1 };
  const correctionDayTwo = { ...legacyCorrection, meetingDay: 1 };
  expect(
    latestOfflineRollCall(snapshot, [legacyDayTwo, correctionDayTwo], bookingId, "after_dive_1")
      ?.state,
  ).toBe("not_boarded");
});

for (const role of ["diver", "crew"] as const) {
  it(`does not carry an unresolved ${role} departure absence as an off-boat exemption`, () => {
    const snapshot = crewSnapshot();
    const manifest = snapshot.manifests[0];
    const proof = `33333333-3333-4333-8333-333333333333.0.a.b.0.${"a".repeat(43)}`;
    snapshot.rollCallMeetingDays = [
      {
        startsAt: "2026-08-01T10:00:00Z",
        endsAt: "2026-08-01T11:00:00Z",
        meetingIdentityProof: proof,
      },
    ];
    const subject =
      role === "diver"
        ? { bookingId: manifest.divers[0].bookingId }
        : { crewPersonId: manifest.crew[0].id as string };
    const uncertain: OfflineRollCallEvent = {
      clientEventId: crypto.randomUUID(),
      snapshotId: snapshot.snapshotId,
      snapshotSavedAt: snapshot.savedAt,
      tripId: manifest.trip.id,
      ...subject,
      checkpoint: "departure",
      status: "not_boarded",
      meetingDay: 0,
      meetingIdentityProof: proof,
      occurredAt: snapshot.savedAt,
      syncStatus: "pending",
      unresolvedReason: "unresolved_predecessor",
    };
    const result =
      role === "diver"
        ? latestOfflineRollCall(snapshot, [uncertain], manifest.divers[0].bookingId, "after_dive_1")
        : latestOfflineCrewRollCall(
            snapshot,
            [uncertain],
            manifest.crew[0].id as string,
            "after_dive_1",
          );
    expect(result?.implied).not.toBe(true);
    expect(result?.state).not.toBe("not_boarded");
  });
  for (const checkpoint of ["departure", "after_dive_1"] as const) {
    it(`keeps an unsent ambiguous ${role} mark from being silently resolved at ${checkpoint}`, () => {
      const snapshot = crewSnapshot();
      const manifest = snapshot.manifests[0];
      manifest.checkpoint = checkpoint;
      snapshot.rollCallMeetingDays = [
        {
          startsAt: "2026-08-01T10:00:00Z",
          endsAt: "2026-08-01T11:00:00Z",
          meetingIdentityProof:
            "11111111-1111-4111-8111-111111111111.0.a.b.0.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      ];
      const subject =
        role === "diver"
          ? { bookingId: manifest.divers[0].bookingId }
          : { crewPersonId: manifest.crew[0].id as string };
      const missing: OfflineRollCallEvent = {
        clientEventId: crypto.randomUUID(),
        snapshotId: "older-copy",
        snapshotSavedAt: snapshot.savedAt,
        tripId: manifest.trip.id,
        ...subject,
        checkpoint,
        status: "not_boarded",
        meetingDay: 0,
        meetingIdentityProof:
          "22222222-2222-4222-8222-222222222222.0.c.d.0.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        occurredAt: snapshot.savedAt,
        syncStatus: "pending",
      };
      const correction: OfflineRollCallEvent = {
        ...missing,
        clientEventId: crypto.randomUUID(),
        snapshotId: snapshot.snapshotId,
        meetingIdentityProof:
          "11111111-1111-4111-8111-111111111111.0.a.b.0.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        status: "boarded",
        observedEvidenceIds: [`client:${missing.clientEventId}`],
      };
      const result =
        role === "diver"
          ? latestOfflineRollCall(
              snapshot,
              [missing, correction],
              manifest.divers[0].bookingId,
              checkpoint,
            )
          : latestOfflineCrewRollCall(
              snapshot,
              [missing, correction],
              manifest.crew[0].id as string,
              checkpoint,
            );
      expect(result?.state).not.toBe("boarded");
      if (checkpoint !== "departure") expect(result?.state).toBe("not_boarded");
      const legacyMissing = {
        ...missing,
        snapshotId: snapshot.snapshotId,
        meetingIdentityProof: undefined,
      };
      const legacyCorrection = { ...correction, meetingIdentityProof: undefined };
      const legacyResult =
        role === "diver"
          ? latestOfflineRollCall(
              snapshot,
              [legacyMissing, legacyCorrection],
              manifest.divers[0].bookingId,
              checkpoint,
            )
          : latestOfflineCrewRollCall(
              snapshot,
              [legacyMissing, legacyCorrection],
              manifest.crew[0].id as string,
              checkpoint,
            );
      expect(legacyResult?.state).not.toBe("boarded");
      if (checkpoint !== "departure") expect(legacyResult?.state).toBe("not_boarded");
    });
  }
}

for (const role of ["diver", "crew"] as const) {
  it(`keeps independent compatible ${role} evidence confirmed through a queued and refreshed exact undo`, () => {
    const saved = crewSnapshot();
    const proof = `33333333-3333-4333-8333-333333333333.0.a.b.0.${"a".repeat(43)}`;
    saved.rollCallMeetingDays = [
      {
        startsAt: "2026-08-01T10:00:00Z",
        endsAt: "2026-08-01T11:00:00Z",
        meetingIdentityProof: proof,
      },
    ];
    const manifest = saved.manifests[0];
    const row = role === "diver" ? manifest.divers[0] : manifest.crew[0];
    if (!row) throw new Error("missing fixture subject");
    const subject =
      role === "diver"
        ? { bookingId: manifest.divers[0].bookingId }
        : { crewPersonId: manifest.crew[0].id as string };
    const read = (events: OfflineRollCallEvent[]) =>
      role === "diver"
        ? latestOfflineRollCall(saved, events, manifest.divers[0].bookingId, "departure")
        : latestOfflineCrewRollCall(saved, events, manifest.crew[0].id as string, "departure");
    const mark = (clientEventId: string): OfflineRollCallEvent => ({
      clientEventId,
      snapshotId: saved.snapshotId,
      snapshotSavedAt: saved.savedAt,
      tripId: manifest.trip.id,
      ...subject,
      checkpoint: "departure",
      status: "not_boarded",
      occurredAt: saved.savedAt,
      note: null,
      meetingDay: 0,
      meetingIdentityProof: proof,
      observedEvidenceIds: [],
      syncStatus: "pending",
    });
    const mine = mark(crypto.randomUUID());
    const theirs = mark(crypto.randomUUID());
    const undo: OfflineRollCallEvent = {
      ...mark(crypto.randomUUID()),
      status: "cleared",
      observedEvidenceIds: [`client:${mine.clientEventId}`],
      retractsClientEventId: mine.clientEventId,
    };
    const events = [mine, theirs, undo];
    const context = offlineCausalContext(saved, events, subject, "departure");
    expect(context.observedEvidenceIds).toEqual(
      [`client:${theirs.clientEventId}`, `client:${undo.clientEventId}`].sort(),
    );
    expect(read(events)?.state).toBe("not_boarded");
    // A real refreshed frame retains validated closure, including the now
    // withdrawn target. Neither receipt order nor an audit clock supplies it.
    row.rollCallContext = {
      ...context,
      ancestry: events.map((event) => ({
        id: `client:${event.clientEventId}`,
        status: event.status,
        observed: event.observedEvidenceIds,
        retracts: event.retractsClientEventId ? `client:${event.retractsClientEventId}` : undefined,
      })),
    };
    expect(read([])?.state).toBe("not_boarded");
    expect(row.rollCallContext.conflict).toBe(false);
  });
}
