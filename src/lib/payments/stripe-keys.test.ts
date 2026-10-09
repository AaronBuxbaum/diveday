import { describe, expect, it } from "vitest";
import {
  demoStripeAccount,
  platformKeyIsLive,
  StripeKeyUnavailableError,
  secretKeyForCall,
  stripeKeySourceFromEnvironment,
  stripeSecretKeyFor,
} from "./stripe-keys";

const LIVE = "sk_live_platformKey123";
const TEST = "sk_test_demoKey12345";
const DEMO = "acct_demoTestMode1";
const env = {
  STRIPE_SECRET_KEY: LIVE,
  STRIPE_DEMO_ACCOUNT_ID: DEMO,
  STRIPE_DEMO_SECRET_KEY: TEST,
};

describe("which key a Stripe call uses (ADR 20261009-demo-test-mode-payments)", () => {
  it("uses the platform key for every shop's account", () => {
    expect(stripeSecretKeyFor("acct_realShop123", env)).toBe(LIVE);
  });

  it("uses only the test-mode key for the demo's account", () => {
    expect(stripeSecretKeyFor(DEMO, env)).toBe(TEST);
  });

  it("never hands the demo's account the live key, whatever is missing or wrong", () => {
    for (const demoKey of [
      undefined,
      "",
      "   ",
      LIVE,
      "rk_live_abcdefgh",
      "sk_test_",
      "pk_test_abcdefgh",
    ]) {
      expect(stripeSecretKeyFor(DEMO, { ...env, STRIPE_DEMO_SECRET_KEY: demoKey })).toBeNull();
    }
    // A malformed account id is still the demo's, and still gets no key.
    const malformed = { ...env, STRIPE_DEMO_ACCOUNT_ID: "acct_x" };
    expect(stripeSecretKeyFor("acct_x", malformed)).toBeNull();
  });

  it("accepts a restricted test key, and trims what was pasted", () => {
    expect(
      stripeSecretKeyFor(DEMO, { ...env, STRIPE_DEMO_SECRET_KEY: " rk_test_abcdefgh\n" }),
    ).toBe("rk_test_abcdefgh");
  });

  it("knows a demo pair only when both halves are valid", () => {
    expect(demoStripeAccount(env)).toEqual({ accountId: DEMO, secretKey: TEST });
    expect(demoStripeAccount({ ...env, STRIPE_DEMO_ACCOUNT_ID: "not-an-account" })).toBeNull();
    expect(demoStripeAccount({ ...env, STRIPE_DEMO_SECRET_KEY: LIVE })).toBeNull();
    expect(demoStripeAccount({ STRIPE_SECRET_KEY: LIVE })).toBeNull();
  });

  it("tells a live platform from a test one", () => {
    expect(platformKeyIsLive(env)).toBe(true);
    expect(platformKeyIsLive({ STRIPE_SECRET_KEY: "rk_live_abc" })).toBe(true);
    expect(platformKeyIsLive({ STRIPE_SECRET_KEY: TEST })).toBe(false);
    expect(platformKeyIsLive({})).toBe(false);
  });
});

describe("a provider's key source", () => {
  it("is absent when no call could have a key", () => {
    expect(stripeKeySourceFromEnvironment({})).toBeNull();
    expect(stripeKeySourceFromEnvironment({ STRIPE_DEMO_ACCOUNT_ID: DEMO })).toBeNull();
  });

  it("routes per account, and refuses a call with no key rather than guess", () => {
    const source = stripeKeySourceFromEnvironment(env);
    if (!source) throw new Error("expected a key source");
    expect(secretKeyForCall(source, "acct_realShop123")).toBe(LIVE);
    expect(secretKeyForCall(source, DEMO)).toBe(TEST);

    const demoOnly = stripeKeySourceFromEnvironment({ ...env, STRIPE_SECRET_KEY: "" });
    if (!demoOnly) throw new Error("the demo pair alone is a key source");
    expect(secretKeyForCall(demoOnly, DEMO)).toBe(TEST);
    expect(() => secretKeyForCall(demoOnly, "acct_realShop123")).toThrow(StripeKeyUnavailableError);
  });

  it("passes a fixed key straight through", () => {
    expect(secretKeyForCall({ secretKey: "sk_test_fixed" }, "acct_any")).toBe("sk_test_fixed");
  });
});

describe("isDemoTestModeAccount", () => {
  it("is the configured demo account and nothing else", async () => {
    const { isDemoTestModeAccount } = await import("./stripe-keys");
    expect(isDemoTestModeAccount(DEMO, env)).toBe(true);
    expect(isDemoTestModeAccount("acct_realShop123", env)).toBe(false);
    expect(isDemoTestModeAccount(null, env)).toBe(false);
    // Half a pair is no test-mode account: its calls get no key at all.
    expect(isDemoTestModeAccount(DEMO, { ...env, STRIPE_DEMO_SECRET_KEY: "" })).toBe(false);
  });
});
