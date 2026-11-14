import { expect, it } from "vitest";
import type { AppDb } from "@/db/client";
import { listRetainedSafetyReviewEntries, readUnresolvedRollCallObservation } from "./recovery";
import { unresolvedDeferralAvailable, unresolvedReviewAvailable } from "./review-availability";
import { deferUnresolvedReview } from "./review-decision";

it("keeps server review disabled until durable handoff safeguards are complete", async () => {
  expect(unresolvedReviewAvailable()).toBe(false);
  expect(unresolvedDeferralAvailable()).toBe(false);
  // A future caller of the internal reader must not bypass the route guard.
  const db = {} as AppDb;
  expect(
    await listRetainedSafetyReviewEntries(db, {
      shopId: "shop",
      staffPersonId: "staff",
      sessionId: "session",
      tripId: "trip",
    }),
  ).toEqual({ ok: false, reason: "unavailable" });
  expect(
    await readUnresolvedRollCallObservation(db, {
      shopId: "shop",
      staffPersonId: "staff",
      tripId: "trip",
      clientEventId: "event",
      sessionId: "session",
    }),
  ).toEqual({ ok: false, reason: "unavailable" });
});

it("refuses a deferral before touching the database while its invariant is incomplete", async () => {
  const id = "8b96bd08-79e0-4e61-912d-1521d040ee13";
  expect(
    await deferUnresolvedReview({} as AppDb, {
      shopId: id,
      staffPersonId: id,
      sessionId: id,
      tripId: id,
      clientEventId: id,
      reviewRevision: id,
      requestId: id,
    }),
  ).toEqual({ ok: false, reason: "unavailable" });
});
