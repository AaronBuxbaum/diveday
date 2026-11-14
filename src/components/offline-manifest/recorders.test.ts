import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { offlineManifestTranslator } from "@/i18n/offline-manifest-messages";
import {
  appendOfflineArrival,
  appendOfflineChecklistCheck,
  appendOfflineRollCall,
  OfflineManifestError,
} from "@/lib/offline-manifest-store";
import type { OfflineManifestEnvelope } from "@/lib/offline-manifests";
import { signOfflineMeetingIdentity } from "@/lib/offline-meeting-identity";
import { offlineCausalContext, offlineReviewReasons } from "@/lib/roll-call-offline-causality";
import { offlineRecorders } from "./recorders";
import { savedCopy } from "./section-fixtures";

vi.mock("@/lib/offline-manifest-store", async (original) => ({
  ...(await original<typeof import("@/lib/offline-manifest-store")>()),
  appendOfflineRollCall: vi.fn(),
  appendOfflineChecklistCheck: vi.fn(),
  appendOfflineArrival: vi.fn(),
}));

const t = offlineManifestTranslator("en-US");
const append = vi.mocked(appendOfflineRollCall);

function recorders({
  expired = false,
  checkpoint = "after_dive_1" as const,
  envelope = savedCopy(),
  tripId = "trip-1",
} = {}) {
  const spies = {
    setNoteDrafts: vi.fn(),
    setBusyBooking: vi.fn(),
    setBusyChecklistItem: vi.fn(),
    setBusyArrival: vi.fn(),
    dispatchSaved: vi.fn(),
    setMessage: vi.fn(),
    reconcile: vi.fn(async () => {}),
  };
  const taps = offlineRecorders({
    t,
    tripId,
    envelope,
    checkpoint,
    expired,
    noteDrafts: { "b-priya": "  surfaced north  " },
    ...spies,
  });
  return { taps, spies };
}

/** What the row's busy mark is once the tap's last update has run on `current`. */
function busyAfterTap(setBusy: ReturnType<typeof vi.fn>, current: string | null) {
  const update = setBusy.mock.calls.at(-1)?.[0];
  return typeof update === "function" ? update(current) : update;
}

beforeEach(() => {
  append.mockReset();
  vi.stubGlobal("navigator", { onLine: false });
});
afterEach(() => vi.unstubAllGlobals());

describe("offlineRecorders' roll-call tap", () => {
  it("reports a concurrent write without clearing a roll-call draft", async () => {
    append.mockRejectedValue(new OfflineManifestError("write_conflict"));
    const { taps, spies } = recorders();
    await taps.record({ bookingId: "b-priya" }, { status: "not_boarded" });
    expect(spies.setMessage).toHaveBeenCalledWith(
      t("shared.offlineManifest.single.record.genericError"),
    );
    expect(spies.setNoteDrafts).not.toHaveBeenCalled();
    expect(spies.dispatchSaved).not.toHaveBeenCalled();
  });
  it("queues nothing on an expired copy, and says why", async () => {
    const { taps, spies } = recorders({ expired: true });
    await taps.record({ bookingId: "b-priya" }, { status: "not_boarded" });
    expect(append).not.toHaveBeenCalled();
    expect(spies.setMessage).toHaveBeenCalledWith(
      t("shared.offlineManifest.single.record.expiredCannotRecord"),
    );
  });

  it("carries the row's sentence on a not-aboard after a dive, and clears the draft once it went", async () => {
    append.mockResolvedValue(savedCopy() as OfflineManifestEnvelope);
    const { taps, spies } = recorders();
    await taps.record({ bookingId: "b-priya" }, { status: "not_boarded" });
    expect(append).toHaveBeenCalledWith(
      "trip-1",
      expect.objectContaining({
        bookingId: "b-priya",
        status: "not_boarded",
        note: "surfaced north",
      }),
    );
    expect(spies.setNoteDrafts).toHaveBeenCalledTimes(1);
    expect(spies.setMessage).toHaveBeenCalledWith(t("shared.offlineManifest.single.record.saved"));
    expect(busyAfterTap(spies.setBusyBooking, "b-priya")).toBeNull();
  });

  it("says the store's refusal in its own words and keeps the draft", async () => {
    append.mockRejectedValue(new OfflineManifestError("not_allowed"));
    const { taps, spies } = recorders();
    await taps.record({ bookingId: "b-priya" }, { status: "not_boarded" });
    expect(spies.setMessage).toHaveBeenCalledWith(
      t("shared.offlineManifest.single.record.notAllowed"),
    );
    expect(spies.setNoteDrafts).not.toHaveBeenCalled();
    expect(busyAfterTap(spies.setBusyBooking, "b-priya")).toBeNull();
  });
});

it("reports concurrent checklist and arrival writes as unsaved", async () => {
  vi.mocked(appendOfflineChecklistCheck).mockRejectedValue(
    new OfflineManifestError("write_conflict"),
  );
  vi.mocked(appendOfflineArrival).mockRejectedValue(new OfflineManifestError("write_conflict"));
  const { taps, spies } = recorders();
  await taps.recordChecklistCheck("item-1", "checked");
  await taps.recordArrival("b-priya", "arrived");
  expect(spies.setMessage).toHaveBeenCalledTimes(2);
  expect(spies.setMessage).toHaveBeenCalledWith(
    t("shared.offlineManifest.single.record.genericError"),
  );
  expect(spies.dispatchSaved).not.toHaveBeenCalled();
});

/**
 * Captain review S2: on a link that carries nothing a sync takes its whole
 * deadline, and each tap held its row busy for it while the mark was already
 * safe on the phone. Counting a boat back aboard, every name froze.
 */
describe("offlineRecorders on a link that answers nothing", () => {
  beforeEach(() => vi.stubGlobal("navigator", { onLine: true }));

  it("frees the row once the tap is on the phone, without waiting for the sync", async () => {
    append.mockResolvedValue(savedCopy() as OfflineManifestEnvelope);
    const { taps, spies } = recorders();
    spies.reconcile.mockImplementation(() => new Promise<void>(() => {}));

    await taps.record({ bookingId: "b-priya" }, { status: "boarded" });

    expect(spies.reconcile).toHaveBeenCalledTimes(1);
    expect(busyAfterTap(spies.setBusyBooking, "b-priya")).toBeNull();
    expect(spies.setMessage).toHaveBeenLastCalledWith(
      t("shared.offlineManifest.single.record.saved"),
    );
  });

  it("clears only its own row, never the one tapped after it", async () => {
    append.mockResolvedValue(savedCopy() as OfflineManifestEnvelope);
    const { taps, spies } = recorders();

    await taps.record({ bookingId: "b-priya" }, { status: "boarded" });

    expect(busyAfterTap(spies.setBusyBooking, "b-ben")).toBe("b-ben");
  });
});

it("captures the signed implicit meeting when no day is explicitly selected", async () => {
  const envelope = savedCopy();
  envelope.snapshot.rollCallMeetingDays = [
    {
      startsAt: "2026-08-01T13:00:00.000Z",
      endsAt: "2026-08-01T16:00:00.000Z",
      meetingIdentityProof: "signed-meeting",
    },
  ];
  append.mockResolvedValue(envelope);
  const { taps } = recorders({ envelope });
  await taps.record({ bookingId: "b-priya" }, { status: "boarded" });
  expect(append).toHaveBeenCalledWith(
    "trip-1",
    expect.objectContaining({ meetingDay: 0, meetingIdentityProof: "signed-meeting" }),
  );
});

it("retains a proofless predecessor for review without inventing an observation", async () => {
  const envelope = savedCopy();
  envelope.snapshot.manifests[0].checkpoint = "after_dive_1";
  const row = envelope.snapshot.manifests
    .find((item) => item.checkpoint === "after_dive_1")
    ?.divers.find((item) => item.bookingId === "b-priya");
  if (!row) throw new Error("fixture missing diver");
  row.rollCall = {
    state: "boarded",
    occurredAt: envelope.snapshot.savedAt,
    recordedByName: "Older crew",
  };
  const clientEventId = "10000000-0000-4000-8000-000000000001";
  envelope.events.push({
    clientEventId,
    snapshotId: envelope.snapshot.snapshotId,
    snapshotSavedAt: envelope.snapshot.savedAt,
    tripId: "trip-1",
    bookingId: "b-priya",
    checkpoint: "after_dive_1",
    status: "boarded",
    meetingDay: 0,
    occurredAt: envelope.snapshot.savedAt,
    syncStatus: "pending",
    observedEvidenceIds: [],
  });
  append.mockResolvedValue(envelope);
  const { taps } = recorders({ envelope });
  await taps.record({ bookingId: "b-priya" }, { status: "boarded" });
  expect(offlineReviewReasons(envelope.snapshot, envelope.events).get(clientEventId)).toBe(
    "meeting_identity_unverified",
  );
  expect(append).toHaveBeenCalledWith(
    "trip-1",
    expect.objectContaining({
      observedEvidenceIds: [],
      meetingDay: undefined,
    }),
  );
});

it("leaves compatible frontier statements concurrent when their individual details are hidden", async () => {
  const envelope = savedCopy();
  const tripId = "11111111-1111-4111-8111-111111111111";
  const snapshotId = "22222222-2222-4222-8222-222222222222";
  const startsAt = new Date("2026-08-01T13:00:00.000Z");
  const endsAt = new Date("2026-08-01T16:00:00.000Z");
  const proof = signOfflineMeetingIdentity({
    scheduleGeneration: 0,
    datasetIncarnation: "55555555-5555-4555-8555-555555555555",
    shopId: "33333333-3333-4333-8333-333333333333",
    tripId,
    snapshotId,
    meetingDay: 0,
    meetingId: "44444444-4444-4444-8444-444444444444",
    startsAt,
    endsAt,
  });
  envelope.snapshot.snapshotId = snapshotId;
  envelope.snapshot.rollCallMeetingDays = [
    { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), meetingIdentityProof: proof },
  ];
  envelope.snapshot.manifests[0].trip.id = tripId;
  envelope.snapshot.manifests[0].checkpoint = "after_dive_1";
  const row = envelope.snapshot.manifests[0].divers.find((item) => item.bookingId === "b-priya");
  if (!row) throw new Error("fixture missing diver");
  row.rollCall = {
    state: "boarded",
    occurredAt: envelope.snapshot.savedAt,
    recordedByName: "Older crew",
  };
  const clientEventId = "10000000-0000-4000-8000-000000000001";
  envelope.events.push({
    clientEventId,
    snapshotId,
    snapshotSavedAt: envelope.snapshot.savedAt,
    tripId,
    bookingId: "b-priya",
    checkpoint: "after_dive_1",
    status: "boarded",
    meetingDay: 0,
    meetingIdentityProof: proof,
    occurredAt: envelope.snapshot.savedAt,
    syncStatus: "pending",
    observedEvidenceIds: [],
  });
  append.mockResolvedValue(envelope);
  const { taps } = recorders({ envelope, tripId });
  await taps.record({ bookingId: "b-priya" }, { status: "boarded" });
  expect(append).toHaveBeenCalledWith(
    tripId,
    expect.objectContaining({
      observedEvidenceIds: [],
      meetingDay: 0,
      meetingIdentityProof: proof,
    }),
  );
  // When the pending statement is the sole visible frontier entry, the same
  // row can name that exact statement rather than inferring an unseen edge.
  row.rollCall = undefined;
  await taps.record(
    { bookingId: "b-priya" },
    { status: "boarded" },
    { state: "boarded", implied: false },
  );
  expect(append).toHaveBeenLastCalledWith(
    tripId,
    expect.objectContaining({
      observedEvidenceIds: [`client:${clientEventId}`],
      meetingDay: 0,
      meetingIdentityProof: proof,
    }),
  );
  envelope.events.push({
    ...envelope.events[0],
    clientEventId: "10000000-0000-4000-8000-000000000002",
    status: "not_boarded",
  });
  const conflict = offlineCausalContext(
    envelope.snapshot,
    envelope.events,
    { bookingId: "b-priya" },
    "after_dive_1",
  );
  expect(conflict.conflict).toBe(true);
  await taps.record(
    { bookingId: "b-priya" },
    {
      status: "boarded",
      reconcilesEvidence: true,
      reviewedEvidenceIds: conflict.observedEvidenceIds,
    },
  );
  expect(append).toHaveBeenLastCalledWith(
    tripId,
    expect.objectContaining({
      observedEvidenceIds: conflict.observedEvidenceIds,
      reconcilesEvidence: true,
    }),
  );
  expect(append.mock.calls.at(-1)?.[1]).not.toHaveProperty("reviewedEvidenceIds");
  const sent = append.mock.calls.length;
  envelope.events.push({
    ...envelope.events[0],
    clientEventId: "10000000-0000-4000-8000-000000000003",
  });
  await taps.record(
    { bookingId: "b-priya" },
    {
      status: "boarded",
      reconcilesEvidence: true,
      reviewedEvidenceIds: conflict.observedEvidenceIds,
    },
  );
  expect(append).toHaveBeenCalledTimes(sent);
});

it("does not invent day zero for an older multi-day copy without a captured server day", async () => {
  const envelope = savedCopy();
  envelope.snapshot.manifests[0].checkpoint = "after_dive_1";
  envelope.snapshot.rollCallDayBoundaries = ["2026-08-02T00:00:00.000Z"];
  append.mockResolvedValue(envelope);
  const { taps } = recorders({ envelope });
  await taps.record({ bookingId: "b-priya" }, { status: "not_boarded" });
  expect(append).toHaveBeenCalledWith(
    "trip-1",
    expect.objectContaining({ meetingDay: undefined, observedEvidenceIds: [] }),
  );
});

it("captures the displayed selected day without reusing the previous day's positive evidence", async () => {
  const envelope = savedCopy();
  envelope.snapshot.manifests[0].checkpoint = "after_dive_1";
  envelope.snapshot.rollCallDayBoundaries = ["2026-08-02T00:00:00.000Z"];
  envelope.snapshot.rollCallMeetingDay = 0;
  envelope.snapshot.selectedRollCallMeetingDay = 1;
  envelope.snapshot.rollCallMeetingDays = [
    {
      startsAt: "2026-08-01T08:00:00.000Z",
      endsAt: "2026-08-01T12:00:00.000Z",
      meetingIdentityProof: "day-zero-proof",
    },
    {
      startsAt: "2026-08-02T08:00:00.000Z",
      endsAt: "2026-08-02T12:00:00.000Z",
      meetingIdentityProof: "day-one-proof",
    },
  ];
  const row = envelope.snapshot.manifests[0].divers[0];
  row.rollCallContext = {
    meetingDay: 0,
    conflict: false,
    orderingUnknown: false,
    unknownMeetingDay: false,
    observedEvidenceIds: ["server:10000000-0000-4000-8000-000000000001"],
    evidence: [
      {
        id: "server:10000000-0000-4000-8000-000000000001",
        status: "boarded",
        recordedByName: "Earlier crew",
        occurredAt: envelope.snapshot.savedAt,
        note: null,
        meetingDay: 0,
      },
    ],
  };
  append.mockResolvedValue(envelope);
  const { taps } = recorders({ envelope });
  await taps.record({ bookingId: row.bookingId }, { status: "not_boarded" });
  expect(append).toHaveBeenCalledWith(
    "trip-1",
    expect.objectContaining({
      meetingDay: 1,
      meetingIdentityProof: "day-one-proof",
      observedEvidenceIds: [],
    }),
  );
});
