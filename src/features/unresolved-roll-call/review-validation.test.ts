import { expect, it } from "vitest";
import { validReviewObservation } from "./review-validation";

const id = "f8f4c9fb-ae6f-4d37-b0b2-856ebd04b3e0";
const valid = {
  checkpoint: "after_dive_1",
  status: "not_boarded",
  occurredAt: "2026-11-14T12:00:00.000Z",
  snapshotId: id,
  snapshotSavedAt: "2026-11-14T10:00:00.000Z",
  meetingDay: 1,
  meetingProof: "proof",
  erasureToken: "token",
  observedEvidenceIds: [`client:${id}`],
  retractsEventId: null,
  retractsClientEventId: null,
  reconcilesEvidence: false,
  note: "Seen in water",
};

it("accepts a complete captured observation and retains its exact contents", () => {
  expect(validReviewObservation(valid)).toEqual(valid);
});

it("refuses malformed or incomplete copies instead of inventing a reviewable event", () => {
  for (const copy of [
    null,
    false,
    0,
    "",
    {},
    { ...valid, occurredAt: "not-an-instant" },
    { ...valid, status: "unknown" },
    { ...valid, futureField: "unreviewed" },
    { ...valid, meetingDay: -1 },
    { ...valid, observedEvidenceIds: ["not-evidence"] },
    { ...valid, retractsEventId: "" },
    { ...valid, note: "x".repeat(301) },
    { ...valid, reconcilesEvidence: "false" },
  ]) {
    expect(validReviewObservation(copy)).toBeNull();
  }
});
