import { describe, expect, it } from "vitest";
import { DEV_STAFF_LOGINS } from "@/db/dev-credentials";
import { DEMO_BYPASS_PASSWORD, demoBypassAccepted, demoBypassEnabled } from "./demo-bypass";
import { generateDemoShopIdentity } from "./demo-identity";

const demoEmail = DEV_STAFF_LOGINS.owner.email;

function candidate(overrides: Partial<Parameters<typeof demoBypassAccepted>[0]> = {}) {
  return {
    shopIsDemo: true,
    accountEmail: demoEmail,
    password: DEMO_BYPASS_PASSWORD,
    ...overrides,
  };
}

describe("demoBypassEnabled", () => {
  it("is on in each recognized runtime when no kill switch is set", () => {
    for (const NODE_ENV of ["development", "test", "production"]) {
      expect(demoBypassEnabled({ NODE_ENV })).toBe(true);
    }
  });

  it("fails closed when NODE_ENV is unset or empty", () => {
    expect(demoBypassEnabled({})).toBe(false);
    expect(demoBypassEnabled({ NODE_ENV: "" })).toBe(false);
  });

  it("fails closed on an unrecognized runtime", () => {
    expect(demoBypassEnabled({ NODE_ENV: "staging" })).toBe(false);
    expect(demoBypassEnabled({ NODE_ENV: "Production" })).toBe(false);
  });

  it("honours an explicit off kill switch", () => {
    expect(demoBypassEnabled({ NODE_ENV: "production", DIVEDAY_DEMO_BYPASS: "off" })).toBe(false);
    expect(demoBypassEnabled({ NODE_ENV: "development", DIVEDAY_DEMO_BYPASS: "off" })).toBe(false);
  });

  it("re-enables only on the literal on", () => {
    expect(demoBypassEnabled({ NODE_ENV: "production", DIVEDAY_DEMO_BYPASS: "on" })).toBe(true);
  });

  it("treats a typo in the kill switch as off, never as consent", () => {
    for (const flag of ["0", "1", "true", "false", "ON", "disabled", "off ", "yes"]) {
      expect(demoBypassEnabled({ NODE_ENV: "production", DIVEDAY_DEMO_BYPASS: flag })).toBe(false);
    }
  });

  it("treats an unset variable as the ADR default rather than a typo", () => {
    expect(demoBypassEnabled({ NODE_ENV: "production", DIVEDAY_DEMO_BYPASS: "" })).toBe(true);
  });
});

describe("demoBypassAccepted", () => {
  const prod = { NODE_ENV: "production" };

  it("admits the canonical demo fixture's staff", () => {
    expect(demoBypassAccepted(candidate(), prod)).toBe(true);
  });

  it("admits a freshly minted per-visitor demo's generated staff", () => {
    const identity = generateDemoShopIdentity();
    expect(demoBypassAccepted(candidate({ accountEmail: identity.emailFor("dana") }), prod)).toBe(
      true,
    );
  });

  it("refuses when the shop is not a demo shop", () => {
    expect(demoBypassAccepted(candidate({ shopIsDemo: false }), prod)).toBe(false);
  });

  it("refuses a routable address even when is_demo has been flipped on", () => {
    // The finding this closes: is_demo alone used to be the whole gate, so
    // anything able to set that column turned the demo password into a master
    // key for a real tenant's staff.
    expect(
      demoBypassAccepted(candidate({ accountEmail: "owner@realshop.example.com" }), prod),
    ).toBe(false);
  });

  it("refuses a lookalike of the reserved namespace", () => {
    for (const accountEmail of [
      "owner@demo.invalid.example.com",
      "owner@notdemo.invalid",
      "owner@demo-invalid",
      "owner@invalid",
    ]) {
      expect(demoBypassAccepted(candidate({ accountEmail }), prod)).toBe(false);
    }
  });

  it("refuses when there is no account at all", () => {
    expect(demoBypassAccepted(candidate({ accountEmail: "" }), prod)).toBe(false);
  });

  it("refuses any other password", () => {
    expect(demoBypassAccepted(candidate({ password: "Password" }), prod)).toBe(false);
    expect(demoBypassAccepted(candidate({ password: "" }), prod)).toBe(false);
  });

  it("refuses in an unrecognized runtime even when every other condition holds", () => {
    expect(demoBypassAccepted(candidate(), { NODE_ENV: "staging" })).toBe(false);
    expect(demoBypassAccepted(candidate(), {})).toBe(false);
  });

  it("refuses when the operator killed the switch", () => {
    expect(demoBypassAccepted(candidate(), { ...prod, DIVEDAY_DEMO_BYPASS: "off" })).toBe(false);
  });
});
