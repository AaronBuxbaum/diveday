import { describe, expect, it } from "vitest";
import { diver, t } from "./diver-roll-call-test-fixtures";
import { tripManifest } from "./manifest-page-test-fixtures";
import { offlineManifestPayload } from "./offline-payload";

describe("offlineManifestPayload", () => {
  it("carries every checkpoint, the shop's emergency reference and the boat check", () => {
    const payload = offlineManifestPayload({
      completeManifests: [
        tripManifest({ checkpoint: "departure", divers: [diver()] }),
        tripManifest({ checkpoint: "after_dive_1", divers: [diver()] }),
      ],
      shop: {
        name: "Blue Mantis",
        timezone: "America/New_York",
        emergencyReference: null as never,
      },
      shopSlug: "blue-mantis",
      checklistItems: [{ id: "radio", label: "Radio check" }] as never,
      checklistChecks: new Map() as never,
      boatSafety: null,
      t,
    });
    expect(payload.shop.slug).toBe("blue-mantis");
    expect(payload.manifests.map((entry) => entry.checkpoint)).toEqual([
      "departure",
      "after_dive_1",
    ]);
  });
});
