import { describe, expect, it, vi } from "vitest";
import {
  createInstallPreference,
  HOME_SCREEN_INSTALL_DISMISSED_KEY,
  installPlatform,
} from "./rules";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36";

describe("home-screen install support", () => {
  it.each([
    [IPHONE, 5, "ios-safari"],
    [IPHONE.replace("Version/18.0", "CriOS/140.0.0.0"), 5, "ios-other"],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
      5,
      "ios-safari",
    ],
    [ANDROID, 5, "android-chrome"],
    [ANDROID.replace("Android 15;", "Android 15; wv;"), 5, null],
    [`${IPHONE} Instagram`, 5, null],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
      5,
      null,
    ],
    [ANDROID.replace("Mobile ", ""), 5, "android-chrome"],
    [
      ANDROID.replace("Chrome/140.0.0.0", "SamsungBrowser/28.0 Chrome/140.0.0.0"),
      5,
      "android-other",
    ],
    ["Mozilla/5.0 (Android 15; Mobile; rv:140.0) Gecko/140.0 Firefox/140.0", 5, "android-other"],
    ["Mozilla/5.0 (Windows NT 10.0) Chrome/140.0.0.0 Safari/537.36", 0, null],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Version/18.0 Safari/605.1.15", 0, null],
  ])("classifies %s with %i touch points as %s", (userAgent, maxTouchPoints, expected) => {
    expect(installPlatform({ userAgent, maxTouchPoints })).toBe(expected);
  });
});

describe("device install dismissal", () => {
  it("reads a persisted dismissal and writes one device-wide key", () => {
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    const preference = createInstallPreference();
    expect(preference.dismissed(() => storage)).toBe(false);
    preference.dismiss(() => storage);
    expect(storage.setItem).toHaveBeenCalledWith(HOME_SCREEN_INSTALL_DISMISSED_KEY, "yes");
    expect(preference.dismissed(() => storage)).toBe(true);
    expect(createInstallPreference().dismissed(() => ({ ...storage, getItem: () => "yes" }))).toBe(
      true,
    );
  });

  it("fails closed when even opening or reading storage is refused", () => {
    expect(
      createInstallPreference().dismissed(() => {
        throw new Error("private");
      }),
    ).toBe(true);
    expect(
      createInstallPreference().dismissed(() => ({
        getItem: () => {
          throw new Error("private");
        },
      })),
    ).toBe(true);
  });

  it("keeps a refused write dismissed across remounts for this document", () => {
    const preference = createInstallPreference();
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(preference.dismissed(() => storage)).toBe(false);
    expect(() => preference.dismiss(() => storage)).not.toThrow();
    expect(preference.dismissed(() => storage)).toBe(true);
    preference.dismiss(() => storage);
    expect(preference.dismissed(() => storage)).toBe(true);
  });
});
