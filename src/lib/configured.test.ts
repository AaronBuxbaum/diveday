import { describe, expect, it } from "vitest";
import { configuredValue } from "./configured";
import { APP_ORIGIN, publicAppUrl } from "./notifications";
import { DEFAULT_SENDER } from "./notifications/ses";
import { CONNECT_CLIENT_ID } from "./payments/connect";

describe("configuredValue", () => {
  it("uses the compiled default when nothing overrides it", () => {
    expect(configuredValue(undefined, "fallback")).toBe("fallback");
  });

  it("prefers an override, trimmed", () => {
    expect(configuredValue("override", "fallback")).toBe("override");
    expect(configuredValue("  override  ", "fallback")).toBe("override");
  });

  /**
   * The case `||` gets wrong, and the reason this function exists. `pnpm
   * e2e:build` runs `DATABASE_URL= NEXT_PUBLIC_SENTRY_DSN= next build` to
   * switch those off; reading an empty assignment as "no preference" would
   * hand back the real value and defeat the switch.
   */
  it("treats an explicitly empty override as off, not as absent", () => {
    expect(configuredValue("", "fallback")).toBeUndefined();
    expect(configuredValue("   ", "fallback")).toBeUndefined();
  });
});

/**
 * Each constant asserted as itself. These are DiveDay's own identifiers, which
 * used to travel from `.env.example` through Secrets Manager to Vercel on
 * every deploy so the deployment could be told what the repository already
 * knew — the round trip that corrupted the SES sender in issue #517.
 */
describe("the compiled constants", () => {
  it("names DiveDay's own origin", () => {
    expect(APP_ORIGIN).toBe("https://dive.day");
    // The property that matters downstream: it survives the same validation
    // every bearer-token link is built through.
    expect(publicAppUrl({})).toBe("https://dive.day");
  });

  it("names a sender SES can actually parse", () => {
    // The exact shape #517 proved SES needs: a display name and a real
    // `<local@domain>` after it, with no stray quote characters.
    expect(DEFAULT_SENDER).toBe("DiveDay <noreply@ses.dive.day>");
    expect(DEFAULT_SENDER).toMatch(/^[^"']+<[^@\s"']+@[^@\s"']+\.[A-Za-z]{2,}>$/);
  });

  it("names the Connect application shops connect to", () => {
    expect(CONNECT_CLIENT_ID).toMatch(/^ca_[A-Za-z0-9]+$/);
  });
});
