import { describe, expect, it } from "vitest";
import {
  isCurrentAccountSession,
  sessionDeviceLabel,
  sessionUserAgentDetails,
} from "./account-session-device";

describe("isCurrentAccountSession", () => {
  it("marks only an exact server-known session id and leaves missing identity unknown", () => {
    expect(isCurrentAccountSession("session-current", "session-current")).toBe(true);
    expect(isCurrentAccountSession("session-current", "session-other")).toBe(false);
    expect(isCurrentAccountSession(undefined, "session-current")).toBe(false);
  });
});

describe("sessionUserAgentDetails", () => {
  it("bounds the raw disclosure and preserves missing values", () => {
    expect(sessionUserAgentDetails("x".repeat(900))).toHaveLength(512);
    expect(sessionUserAgentDetails(null)).toBeNull();
  });
});

describe("sessionDeviceLabel", () => {
  it.each([
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36",
      { browser: "chrome", os: "windows" },
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15",
      { browser: "safari", os: "macOs" },
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
      { browser: "safari", os: "ios" },
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 CriOS/125.0.0.0 Mobile/15E148 Safari/604.1",
      { browser: "chrome", os: "ios" },
    ],
    [
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/125.0.0.0 Mobile Safari/537.36",
      { browser: "chrome", os: "android" },
    ],
    [
      "Mozilla/5.0 (X11; CrOS x86_64 15633.58.0) AppleWebKit/537.36 Chrome/110.0.0.0 Safari/537.36",
      { browser: "chrome", os: "chromeOs" },
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Edg/125.0.0.0",
      { browser: "edge", os: "windows" },
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 EdgiOS/125.0.0.0 Mobile/15E148 Safari/604.1",
      { browser: "edge", os: "ios" },
    ],
    [
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/125.0.0.0 EdgA/125.0.0.0 Mobile Safari/537.36",
      { browser: "edge", os: "android" },
    ],
    [
      "Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/126.0",
      { browser: "firefox", os: "linux" },
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0",
      { browser: "opera", os: "windows" },
    ],
    [
      "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 SamsungBrowser/23.0 Chrome/117.0.0.0",
      { browser: "samsung", os: "android" },
    ],
  ])("recognizes familiar browser and OS tokens", (userAgent, expected) => {
    expect(sessionDeviceLabel(userAgent)).toEqual(expected);
  });

  it.each([null, undefined, "", "some custom client", "x".repeat(513), "Chrome/123\u0000junk"])(
    "keeps missing, unfamiliar, or unsafe user agents unknown",
    (userAgent) => {
      expect(sessionDeviceLabel(userAgent)).toEqual({ browser: null, os: null });
    },
  );

  it("keeps a recognized platform when the browser is unfamiliar", () => {
    expect(sessionDeviceLabel("custom-client (Android 14)")).toEqual({
      browser: null,
      os: "android",
    });
  });
});
