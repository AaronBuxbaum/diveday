import { describe, expect, it } from "vitest";
import { browserSupportsPasskeys } from "./rules";

describe("passkey browser capability", () => {
  const browser = (hostname: string) => ({
    isSecureContext: true,
    PublicKeyCredential: {},
    location: { hostname },
  });
  it("offers a domain or localhost without claiming an account has a key", () => {
    expect(browserSupportsPasskeys(browser("diveday.app"))).toBe(true);
    expect(browserSupportsPasskeys(browser("localhost"))).toBe(true);
  });
  it("refuses IP RP IDs and absent or insecure APIs", () => {
    for (const host of ["127.0.0.1", "[::1]", "192.168.1.1"])
      expect(browserSupportsPasskeys(browser(host))).toBe(false);
    expect(browserSupportsPasskeys({ ...browser("diveday.app"), isSecureContext: false })).toBe(
      false,
    );
    expect(
      browserSupportsPasskeys({ ...browser("diveday.app"), PublicKeyCredential: undefined }),
    ).toBe(false);
  });
});
