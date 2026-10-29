import { afterEach, describe, expect, it, vi } from "vitest";
import { partyReturnCookieSecure } from "./party-return";

afterEach(() => vi.unstubAllEnvs());

describe("party return cookie transport", () => {
  it("keeps return cookies Secure in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DIVEDAY_E2E", "");

    expect(partyReturnCookieSecure()).toBe(true);
  });

  it("omits Secure only for the HTTP loopback e2e fleet", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DIVEDAY_E2E", "1");

    expect(partyReturnCookieSecure()).toBe(false);
  });

  it("does not mark development return cookies Secure", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DIVEDAY_E2E", "");

    expect(partyReturnCookieSecure()).toBe(false);
  });
});
