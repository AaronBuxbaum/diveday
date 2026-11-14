import { expect, it } from "vitest";
import { capturableObservation, type RollCallClaimInput } from "@/db/roll-call-claims";
import type { rollCallEventClaims } from "@/db/schema";
import { retainedObservationMatches } from "./intent-match";

const input: RollCallClaimInput = {
  shopId: "shop",
  tripId: "trip",
  clientEventId: "event",
  recordedByPersonId: "staff",
  subject: { kind: "seat", bookingId: "seat" },
  checkpoint: "after_dive_1",
  status: "not_boarded",
  source: "offline",
  occurredAt: new Date("2026-11-14T08:00:00Z"),
  offlineSnapshotId: "snapshot",
  offlineSnapshotSavedAt: new Date("2026-11-14T07:00:00Z"),
  offlineMeetingIdentityProof: "proof",
  offlineErasureEpochToken: "epoch",
  meetingDay: 0,
  observedEvidenceIds: ["client:prior"],
  reconcilesEvidence: false,
  note: "At the ladder",
};
const claim = {
  shopId: "shop",
  tripId: "trip",
  clientEventId: "event",
  state: "unresolved",
  subjectKind: "seat",
  bookingId: "seat",
  crewPersonId: null,
  noteDisposition: null,
  unresolvedRecordedByPersonId: "staff",
  unresolvedObservation: capturableObservation(input),
} as typeof rollCallEventClaims.$inferSelect;

it("matches only a complete, scoped stored copy of the submitted observation", () => {
  expect(retainedObservationMatches(input, claim)).toBe(true);
  for (const changed of [
    { status: "boarded" },
    { note: "A different note" },
    { meetingDay: 1 },
    { observedEvidenceIds: ["client:other"] },
    { offlineMeetingIdentityProof: "other" },
    { offlineErasureEpochToken: "other" },
    { offlineSnapshotId: "other" },
    { occurredAt: new Date("2026-11-14T08:01:00Z") },
    { tripId: "other" },
    { shopId: "other" },
    { subject: { kind: "seat" as const, bookingId: "other" } },
  ])
    expect(retainedObservationMatches({ ...input, ...changed }, claim)).toBe(false);
});

it("fails closed for missing, incomplete, accepted or unretained records", () => {
  for (const changed of [
    { state: "accepted" },
    { unresolvedObservation: null },
    { unresolvedRecordedByPersonId: null },
    { unresolvedObservation: { ...claim.unresolvedObservation, note: undefined } },
  ])
    expect(retainedObservationMatches(input, { ...claim, ...changed } as typeof claim)).toBe(false);
  expect(retainedObservationMatches({ ...input, offlineSnapshotId: undefined }, claim)).toBe(false);
});

it("does not call a disposed-note copy complete even on an exact or note-less retry", () => {
  const disposed = {
    ...claim,
    noteDisposition: "discarded_erasure_cutoff",
    unresolvedObservation: { ...claim.unresolvedObservation, note: null },
  } as typeof claim;
  expect(retainedObservationMatches(input, disposed)).toBe(false);
  expect(retainedObservationMatches({ ...input, note: "Different" }, disposed)).toBe(false);
  expect(retainedObservationMatches({ ...input, note: null }, disposed)).toBe(false);
});
