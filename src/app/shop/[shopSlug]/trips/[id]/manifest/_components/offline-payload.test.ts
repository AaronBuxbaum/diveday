import { describe, expect, it } from "vitest";
import { diver, t } from "./diver-roll-call-test-fixtures";
import { tripManifest } from "./manifest-page-test-fixtures";
import { offlineManifestPayload } from "./offline-payload";

describe("offlineManifestPayload", () => {
  it("carries every checkpoint, the shop's emergency reference and the boat check", () => {
    const payload = offlineManifestPayload({
      snapshot: {
        manifests: [
          tripManifest({ checkpoint: "departure", divers: [diver()] }),
          tripManifest({ checkpoint: "after_dive_1", divers: [diver()] }),
        ],
        snapshotId: "11111111-1111-4111-8111-111111111111",
        erasureEpochToken: "authenticated-epoch",
        snapshotRevision: 1,
      },
      shop: {
        slug: "blue-mantis",
        name: "Blue Mantis",
        timezone: "America/New_York",
        emergencyReference: null as never,
      },
      checklistItems: [{ id: "radio", label: "Radio check" }] as never,
      checklistChecks: new Map() as never,
      boatSafety: null,
      snags: [],
      locale: "en-US",
      t,
    });
    expect(payload.snags).toBeUndefined();
    expect(payload.shop.slug).toBe("blue-mantis");
    expect(payload.snapshotId).toBe("11111111-1111-4111-8111-111111111111");
    expect(payload.erasureEpochToken).toBe("authenticated-epoch");
    expect(payload.manifests.map((entry) => entry.checkpoint)).toEqual([
      "departure",
      "after_dive_1",
    ]);
  });

  it("carries the boat's open snags, carried and its own, worded for the crew", () => {
    const payload = offlineManifestPayload({
      snapshot: {
        manifests: [tripManifest({ checkpoint: "departure", divers: [diver()] })],
        snapshotId: "22222222-2222-4222-8222-222222222222",
        erasureEpochToken: "authenticated-epoch",
        snapshotRevision: 1,
      },
      shop: {
        slug: "blue-mantis",
        name: "Blue Mantis",
        timezone: "America/New_York",
        emergencyReference: null as never,
      },
      checklistItems: [{ id: "radio", label: "Radio check" }] as never,
      checklistChecks: new Map() as never,
      boatSafety: null,
      snags: [
        {
          id: "s-1",
          checklistItemId: "radio",
          itemLabel: "Radio check",
          note: "VHF crackles on 16",
          notedByName: "Sal Moretti",
          notedAt: new Date("2026-10-14T09:16:00Z"),
          notedHere: false,
          stillThere: { byName: "Ana Ruiz", at: new Date("2026-10-14T17:05:00Z") },
        },
        {
          id: "s-2",
          checklistItemId: "radio",
          itemLabel: "Radio check",
          note: "Handheld battery low",
          notedByName: "Ana Ruiz",
          notedAt: new Date("2026-10-15T09:10:00Z"),
          notedHere: true,
          stillThere: null,
        },
      ],
      locale: "en-US",
      t,
    });
    expect(payload.snags?.heading).toBe("Open on this boat");
    expect(payload.snags?.items).toEqual([
      {
        line: "Radio check: VHF crackles on 16",
        notedBy: expect.stringContaining("Noted by Sal Moretti"),
        stillThere: expect.stringContaining("Ana Ruiz found it still there"),
      },
      {
        line: "Radio check: Handheld battery low",
        notedBy: expect.stringContaining("Noted by Ana Ruiz"),
      },
    ]);
  });
});
