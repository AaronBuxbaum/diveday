// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { appendOfflineRollCall, saveOfflineManifest } from "./offline-manifest-store";
import type { OfflineManifestPayload } from "./offline-manifests";

const payload: OfflineManifestPayload = {
  shop: {
    slug: "blue-mantis",
    name: "Blue Mantis Divers",
    timezone: "America/New_York",
    emergencyReference: { lines: [], vessel: "", shoreContact: "", plan: "" },
  },
  manifests: [
    {
      trip: {
        id: "11111111-1111-1111-1111-111111111111",
        title: "Two-Tank Reef — Molasses & French",
        startsAt: "2026-08-01T13:00:00.000Z",
        endsAt: "2026-08-01T16:30:00.000Z",
        plannedDives: 2,
      },
      checkpoint: "departure",
      crew: [
        {
          // A copy saved since H-20260814-where-diveday-sit-between carries the crew member's person id, which
          // is what makes the crew half of the head count recordable here.
          id: "33333333-3333-3333-3333-333333333333",
          fullName: "Sal Moretti",
          roles: ["captain"],
        },
      ],
      divers: [
        {
          bookingId: "22222222-2222-2222-2222-222222222222",
          fullName: "Nora Quinn",
          email: null,
          emergencyContactName: "Sam Quinn",
          emergencyContactPhone: "+1-305-555-0100",
          readiness: { status: "ready", blockers: [] },
          rentalFit: { state: "not_recorded" as const },
          nitroxRequested: false,
          rollCall: undefined,
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
        overCapacity: 0,
        notHere: 0,
      },
    },
  ],
};

// A second, distinct trip departing earlier than `payload`'s, so the list's
// soonest-departure-first ordering (ADR 20260726-shopwide-offline-manifest-priming)
// has something real to sort against.
describe("saved training policy", () => {
  it("retains queued head counts while refreshing an older training verdict", async () => {
    const manifest = payload.manifests[0];
    const diver = manifest.divers[0];
    const stale: OfflineManifestPayload = {
      ...payload,
      manifests: [
        {
          ...manifest,
          divers: [
            { ...diver, trainingDive: { courseTitle: "Open Water", instructorAboard: true } },
          ],
        },
      ],
    };
    const tripId = manifest.trip.id;
    await saveOfflineManifest(stale);
    await appendOfflineRollCall(tripId, {
      bookingId: diver.bookingId,
      checkpoint: "departure",
      status: "not_boarded",
    });
    await expect(
      appendOfflineRollCall(tripId, {
        bookingId: diver.bookingId,
        checkpoint: "departure",
        status: "boarded",
      }),
    ).rejects.toMatchObject({ code: "not_allowed" });
    const refreshed = await saveOfflineManifest({ ...stale, readinessPolicyVersion: 1 });
    expect(refreshed.events).toHaveLength(1);
    expect(refreshed.events[0]).toMatchObject({ status: "not_boarded", syncStatus: "pending" });
    expect(
      (
        await appendOfflineRollCall(tripId, {
          bookingId: diver.bookingId,
          checkpoint: "departure",
          status: "boarded",
        })
      ).events,
    ).toHaveLength(2);
  });
});
