import { describe, expect, it } from "vitest";
import desktop from "../playwright.config.ts";
import mobile from "../playwright.mobile.config.ts";

describe("mobile behavior runner isolation", () => {
  it("keeps mobile specs out of desktop discovery and selects only them in the mobile lane", () => {
    expect(desktop.testIgnore).toBe("**/mobile*.spec.ts");
    expect(mobile.testMatch).toBe("**/mobile*.spec.ts");
    expect(mobile.testIgnore).toEqual([]);
    expect(desktop.projects.map(({ name }) => name)).toEqual(["chromium"]);
  });

  it("runs both actual engines with mobile input and clears Chromium launch options for WebKit", () => {
    expect(mobile.projects.map(({ use }) => use.browserName)).toEqual(["chromium", "webkit"]);
    for (const { use } of mobile.projects) {
      expect(use.hasTouch).toBe(true);
      expect(use.isMobile).toBe(true);
    }
    expect(mobile.projects[1].use.launchOptions).toEqual({});
    expect(mobile.use.extraHTTPHeaders).toEqual(desktop.use.extraHTTPHeaders);
    expect(mobile.webServer).toEqual(desktop.webServer);
    expect(mobile.retries).toBe(0);
    expect(mobile.timeout).toBe(desktop.timeout);
  });
});
