import { describe, expect, it } from "vitest";
import { manifestReturnHref } from "./manifest-return";

/**
 * Domain review 2026-10-16: a report opened from the manifest's "Start a
 * missing diver report" left the crew on a form with no way back to the roll
 * call, in the minutes the head count matters most.
 */
describe("the way back to the manifest", () => {
  it("leads back to the checkpoint the report was started from", () => {
    expect(
      manifestReturnHref("blue-mantis", "trip-1", { from: "manifest", checkpoint: "after_dive_2" }),
    ).toBe("/shop/blue-mantis/trips/trip-1/manifest?checkpoint=after_dive_2");
  });

  it("leads to the manifest itself when the checkpoint is missing or not one", () => {
    expect(manifestReturnHref("blue-mantis", "trip-1", { from: "manifest" })).toBe(
      "/shop/blue-mantis/trips/trip-1/manifest",
    );
    expect(
      manifestReturnHref("blue-mantis", "trip-1", { from: "manifest", checkpoint: "javascript:" }),
    ).toBe("/shop/blue-mantis/trips/trip-1/manifest");
  });

  it("offers nothing on a report reached any other way", () => {
    expect(manifestReturnHref("blue-mantis", "trip-1", {})).toBeNull();
    expect(manifestReturnHref("blue-mantis", "trip-1", { from: "today" })).toBeNull();
  });
});
