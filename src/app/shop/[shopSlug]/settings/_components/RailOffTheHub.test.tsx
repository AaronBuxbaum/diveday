import { describe, expect, it } from "vitest";
import { isSettingsHubPath } from "./RailOffTheHub";

describe("the settings rail stands down on the hub", () => {
  it("knows the hub from a setting inside it", () => {
    expect(isSettingsHubPath("/shop/blue-mantis/settings")).toBe(true);
    expect(isSettingsHubPath("/shop/blue-mantis/settings/")).toBe(true);
    expect(isSettingsHubPath("/shop/blue-mantis/settings/team")).toBe(false);
    expect(isSettingsHubPath("/shop/blue-mantis/settings/export")).toBe(false);
  });
});
