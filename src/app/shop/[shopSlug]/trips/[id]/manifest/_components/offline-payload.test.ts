import { describe, expect, it } from "vitest";
import { diver, t } from "./diver-roll-call-test-fixtures";
import { tripManifest } from "./manifest-page-test-fixtures";
import { offlineManifestPayload } from "./offline-payload";

describe("offlineManifestPayload", () => {
  it("carries every checkpoint, the shop's emergency reference and the boat check", () => {
    const payload = offlineManifestPayload({
      roster: {
        manifests: [
          tripManifest({ checkpoint: "departure", divers: [diver()] }),
          tripManifest({ checkpoint: "after_dive_1", divers: [diver()] }),
        ],
        erasureEpoch: 3,
        snapshotRevision: 9,
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
      meetingWindows: undefined,
      snags: [],
      locale: "en-US",
      t,
    });
    expect(payload.snags).toBeUndefined();
    expect(payload.shop.slug).toBe("blue-mantis");
    // The epoch and revision the rows were read at, for the device to trade for a signed
    // token when it saves; the page itself issues no snapshot (issue #4391).
    expect(payload.readAt).toEqual({ erasureEpoch: 3, snapshotRevision: 9 });
    expect(payload).not.toHaveProperty("snapshotId");
    expect(payload).not.toHaveProperty("erasureEpochToken");
    expect(payload.manifests.map((entry) => entry.checkpoint)).toEqual([
      "departure",
      "after_dive_1",
    ]);
  });

  it("carries the boat's open snags, carried and its own, worded for the crew", () => {
    const payload = offlineManifestPayload({
      roster: {
        manifests: [tripManifest({ checkpoint: "departure", divers: [diver()] })],
        erasureEpoch: 0,
        snapshotRevision: 0,
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
      meetingWindows: undefined,
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

  it("carries a course's meeting-day boundaries, and nothing for a one-day departure", () => {
    const base = {
      shop: {
        slug: "blue-mantis",
        name: "Blue Mantis",
        timezone: "America/New_York",
        emergencyReference: null as never,
      },
      checklistItems: [] as never,
      checklistChecks: new Map() as never,
      boatSafety: null,
      meetingWindows: undefined,
      snags: [],
      locale: "en-US",
      t,
    };
    const roster = {
      manifests: [tripManifest({ checkpoint: "departure", divers: [diver()] })],
      erasureEpoch: 0,
      snapshotRevision: 0,
    };
    const day = (date: number) => ({
      startsAt: new Date(Date.UTC(2026, 6, date, 10)),
      endsAt: new Date(Date.UTC(2026, 6, date, 14)),
    });
    // Halfway between day one's end (14:00) and day two's start (10:00 the next day).
    expect(
      offlineManifestPayload({ ...base, roster, meetingWindows: [day(20), day(21)] })
        .rollCallDayBoundaries,
    ).toEqual(["2026-07-21T00:00:00.000Z"]);
    expect(
      "rollCallDayBoundaries" in
        offlineManifestPayload({ ...base, roster, meetingWindows: [day(20)] }),
    ).toBe(false);
  });
});
