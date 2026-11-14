import { expect, it } from "vitest";
import { projectReviewObservation } from "./review-projection";

it("shows the reviewable observation and causal summary without proof tokens or evidence identifiers", () => {
  const projected = projectReviewObservation({
    checkpoint: "after_dive_1",
    status: "not_boarded",
    occurredAt: "2026-11-14T12:00:00.000Z",
    meetingDay: 2,
    note: "Saw a diver in the water",
    snapshotId: "snapshot-secret",
    snapshotSavedAt: "2026-11-14T10:00:00.000Z",
    meetingProof: "proof-secret",
    erasureToken: "erase-secret",
    observedEvidenceIds: ["evidence-a", "evidence-b"],
    retractsEventId: "event-secret",
    retractsClientEventId: null,
    reconcilesEvidence: false,
  });
  expect(projected).toEqual({
    checkpoint: "after_dive_1",
    status: "not_boarded",
    occurredAt: "2026-11-14T12:00:00.000Z",
    meetingDay: 2,
    note: "Saw a diver in the water",
    snapshotSavedAt: "2026-11-14T10:00:00.000Z",
    observedEvidenceCount: 2,
    retractsPriorObservation: true,
    reconcilesEvidence: false,
  });
  expect(JSON.stringify(projected)).not.toMatch(/secret|evidence-a|evidence-b/);
});

it("distinguishes unknown causal history from an observed empty frontier", () => {
  const base = {
    checkpoint: "departure",
    status: "boarded",
    occurredAt: null,
    meetingDay: null,
    note: null,
    snapshotId: null,
    snapshotSavedAt: null,
    meetingProof: null,
    erasureToken: null,
    observedEvidenceIds: null,
    retractsEventId: null,
    retractsClientEventId: null,
    reconcilesEvidence: false,
  };
  expect(projectReviewObservation(base).observedEvidenceCount).toBeNull();
  expect(projectReviewObservation({ ...base, observedEvidenceIds: [] }).observedEvidenceCount).toBe(
    0,
  );
});

it("does not invent a retraction when a legacy copy omitted its target fields", () => {
  const legacy = {
    checkpoint: "departure",
    status: "boarded",
    occurredAt: null,
    meetingDay: null,
    note: null,
    snapshotId: null,
    snapshotSavedAt: null,
    meetingProof: null,
    erasureToken: null,
    observedEvidenceIds: null,
    reconcilesEvidence: false,
  };
  expect(projectReviewObservation(legacy as never).retractsPriorObservation).toBeNull();
});
