import { describe, expect, it } from "vitest";
import { t } from "./diver-roll-call-test-fixtures";
import {
  catchUpStripView,
  emergencyReferenceCopy,
  offlineManifestManagerCopy,
} from "./manifest-copy";

describe("the manifest's copy builders", () => {
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
