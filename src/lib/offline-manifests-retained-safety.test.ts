import { expect, it } from "vitest";
import { baseManifest } from "@/test/offline-manifests-test-fixture";
import { EMPTY_EMERGENCY_REFERENCE } from "./emergency-reference";
import { serializeManifests } from "./offline-manifests";

it("retains the alert-delivery warning in a saved manifest", () => {
  const manifest = {
    ...baseManifest(),
    retainedSafetyUnresolved: true,
    retainedSafetyAlertNeedsReview: true,
  };
  const saved = serializeManifests(
    [manifest],
    {
      slug: "blue-mantis",
      name: "Blue Mantis",
      timezone: "America/New_York",
      emergencyReference: EMPTY_EMERGENCY_REFERENCE,
    },
    (blocker) => blocker.code,
  );
  expect(saved.manifests[0]).toMatchObject({
    retainedSafetyUnresolved: true,
    retainedSafetyAlertNeedsReview: true,
  });
});
