import { signOfflineMeetingIdentity } from "@/lib/offline-meeting-identity";
import type { snapshot } from "./substrate-fixtures/lib/offline-manifests-fixtures";

/** A real signed meeting for tests asserting behavior of verified local taps. */
export function verifiedFixture(saved: ReturnType<typeof snapshot>) {
  const tripId = "11111111-1111-4111-8111-111111111111";
  const snapshotId = "22222222-2222-4222-8222-222222222222";
  const startsAt = new Date("2026-07-20T12:00:00.000Z");
  const endsAt = new Date("2026-07-20T16:00:00.000Z");
  const meetingIdentityProof = signOfflineMeetingIdentity({
    scheduleGeneration: 0,
    datasetIncarnation: "55555555-5555-4555-8555-555555555555",
    shopId: "33333333-3333-4333-8333-333333333333",
    tripId,
    snapshotId,
    meetingId: "44444444-4444-4444-8444-444444444444",
    meetingDay: 0,
    startsAt,
    endsAt,
  });
  saved.snapshotId = snapshotId;
  saved.rollCallMeetingDays = [
    { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), meetingIdentityProof },
  ];
  for (const manifest of saved.manifests) manifest.trip.id = tripId;
  return { saved, tripId, meetingIdentityProof };
}
