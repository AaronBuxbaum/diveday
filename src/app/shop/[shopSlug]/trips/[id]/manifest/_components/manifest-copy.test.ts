import { describe, expect, it } from "vitest";
import { t } from "./diver-roll-call-test-fixtures";
import {
  catchUpStripView,
  emergencyReferenceCopy,
  offlineManifestManagerCopy,
  stageStripCopy,
} from "./manifest-copy";

describe("the manifest's copy builders", () => {
  it("names who tapped the stage and when, in the shop's zone", () => {
    const copy = stageStripCopy(
      t,
      {
        stage: "underway",
        recordedByName: "Keiko Tanaka",
        recordedAt: new Date("2026-09-11T12:05:00.000Z"),
      } as never,
      "en-US",
      "America/New_York",
    );
    expect(copy.recordedLine).toContain("Keiko Tanaka");
    expect(copy.recordedLine).toContain("8:05");
    expect(copy.taps.length).toBeGreaterThan(0);
    expect(stageStripCopy(t, null, "en-US", "UTC").recordedLine).toBeUndefined();
  });

  it("draws no catch-up for somebody who has never worked the departure", () => {
    expect(catchUpStripView({ mark: null, events: [] } as never, "en-US", "UTC", t)).toBeNull();
    const view = catchUpStripView(
      { mark: { at: new Date("2026-09-11T12:05:00.000Z") }, events: [] } as never,
      "en-US",
      "UTC",
      t,
    );
    expect(view?.dismissLabel).toBe(t("manifest.catchUp.dismiss"));
    expect(view?.sentences).toEqual([]);
  });

  it("resolves every word the emergency card and the offline copy need", () => {
    expect(emergencyReferenceCopy(t).heading).toBe(t("manifest.emergency.heading"));
    expect(offlineManifestManagerCopy(t).groupHeading).toBe(t("manifest.onThisPhone"));
  });
});
