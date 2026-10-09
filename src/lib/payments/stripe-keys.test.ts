import { describe, expect, it } from "vitest";
import {
  demoStripeAccount,
  mayOfferPayment,
  platformKeyIsLive,
  StripeKeyUnavailableError,
  secretKeyForCall,
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

/** Who holds an account, as the database says (`stripeAccountHolder`). */
const REAL_SHOP = { isDemo: false, isCanonicalDemo: false };
const CANONICAL_DEMO = { isDemo: true, isCanonicalDemo: true };
const MINTED_DEMO = { isDemo: true, isCanonicalDemo: false };

describe("which key a Stripe call uses (ADR 20261009-demo-test-mode-payments)", () => {
  it("uses the platform key for a real shop's account", () => {
    expect(stripeSecretKeyFor("acct_realShop123", REAL_SHOP, env)).toBe(LIVE);
    // An account no row holds is no demo's either.
    expect(stripeSecretKeyFor("acct_realShop123", null, env)).toBe(LIVE);
  });

  it("uses only the test-mode key for the demo's account, held by the canonical demo", () => {
    expect(stripeSecretKeyFor(DEMO, CANONICAL_DEMO, env)).toBe(TEST);
  });

  it("gives the demo's account no key at all when anyone else holds it, or nobody does", () => {
    for (const holder of [REAL_SHOP, MINTED_DEMO, null]) {
      expect(stripeSecretKeyFor(DEMO, holder, env)).toBeNull();
    }
  });

  it("never hands a demo shop the live platform key, whatever account it holds", () => {
    for (const holder of [CANONICAL_DEMO, MINTED_DEMO]) {
      expect(stripeSecretKeyFor("acct_e2e_test", holder, env)).toBeNull();
      expect(
        stripeSecretKeyFor("acct_e2e_test", holder, { STRIPE_SECRET_KEY: "rk_live_abcdefgh" }),
      ).toBeNull();
      // Nor a platform key that is not plainly a test key.
      expect(
        stripeSecretKeyFor("acct_e2e_test", holder, { STRIPE_SECRET_KEY: "sk_mystery" }),
      ).toBeNull();
    }
  });

  it("lets a demo shop use a platform key that is itself test mode, as on a workstation", () => {
    expect(stripeSecretKeyFor("acct_e2e_test", MINTED_DEMO, { STRIPE_SECRET_KEY: TEST })).toBe(
      TEST,
    );
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
      expect(
        stripeSecretKeyFor(DEMO, CANONICAL_DEMO, { ...env, STRIPE_DEMO_SECRET_KEY: demoKey }),
      ).toBeNull();
    }
    // A malformed account id is still the demo's, and still gets no key.
    const malformed = { ...env, STRIPE_DEMO_ACCOUNT_ID: "acct_x" };
    expect(stripeSecretKeyFor("acct_x", CANONICAL_DEMO, malformed)).toBeNull();
    expect(stripeSecretKeyFor("acct_x", REAL_SHOP, malformed)).toBeNull();
  });

  it("accepts a restricted test key, and trims what was pasted", () => {
    expect(
      stripeSecretKeyFor(DEMO, CANONICAL_DEMO, {
        ...env,
        STRIPE_DEMO_SECRET_KEY: " rk_test_abcdefgh\n",
      }),
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

describe("whether a shop may offer payment at all", () => {
  it("always may when it is a real shop", () => {
    expect(mayOfferPayment("acct_realShop123", REAL_SHOP, env)).toBe(true);
    expect(mayOfferPayment("acct_realShop123", REAL_SHOP, {})).toBe(true);
  });

  it("may on the canonical demo only with the configured test-mode account", () => {
    expect(mayOfferPayment(DEMO, CANONICAL_DEMO, env)).toBe(true);
    expect(mayOfferPayment("acct_e2e_test", CANONICAL_DEMO, env)).toBe(false);
    expect(mayOfferPayment(DEMO, MINTED_DEMO, env)).toBe(false);
    expect(mayOfferPayment(DEMO, CANONICAL_DEMO, { ...env, STRIPE_DEMO_SECRET_KEY: "" })).toBe(
      false,
    );
  });

  it("may on any demo where no live key exists to reach", () => {
    expect(mayOfferPayment("acct_e2e_test", MINTED_DEMO, {})).toBe(true);
    expect(mayOfferPayment("acct_e2e_test", MINTED_DEMO, { STRIPE_SECRET_KEY: TEST })).toBe(true);
  });
});

describe("a provider's key source", () => {
  it("refuses a call with no key rather than guess", async () => {
    const source = { secretKeyFor: async (id: string) => (id === DEMO ? TEST : null) };
    expect(await secretKeyForCall(source, DEMO)).toBe(TEST);
    await expect(secretKeyForCall(source, "acct_realShop123")).rejects.toThrow(
      StripeKeyUnavailableError,
    );
  });

  it("passes a fixed key straight through", async () => {
    expect(await secretKeyForCall({ secretKey: "sk_test_fixed" }, "acct_any")).toBe(
      "sk_test_fixed",
    );
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
