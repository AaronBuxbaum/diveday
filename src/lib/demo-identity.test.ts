import { describe, expect, it } from "vitest";
import { DEV_STAFF_LOGINS } from "@/db/dev-credentials";
import { DEMO_EMAIL_DOMAIN, generateDemoShopIdentity, isDemoAccountEmail } from "./demo-identity";

describe("generateDemoShopIdentity", () => {
  it("produces a URL-safe slug and a matching display name", () => {
    const { name, slug } = generateDemoShopIdentity();
    expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(slug).toMatch(/-divers-[0-9a-f]{6}$/);
    expect(name).toMatch(/ Divers$/);
    // The onboarding slug rule (max 50) also comfortably holds here.
    expect(slug.length).toBeLessThanOrEqual(50);
  });

  it("namespaces staff emails under the unique slug so they never collide globally", () => {
    const identity = generateDemoShopIdentity();
    expect(identity.emailFor("dana")).toBe(`dana@${identity.slug}.demo.invalid`);
    expect(identity.emailFor("marcus")).toBe(`marcus@${identity.slug}.demo.invalid`);
  });

  it("is overwhelmingly unlikely to repeat a slug across mints", () => {
    const slugs = new Set(Array.from({ length: 200 }, () => generateDemoShopIdentity().slug));
    expect(slugs.size).toBe(200);
  });
});

describe("isDemoAccountEmail", () => {
  it("recognizes the canonical fixture's staff logins", () => {
    for (const login of Object.values(DEV_STAFF_LOGINS)) {
      expect(isDemoAccountEmail(login.email)).toBe(true);
    }
  });

  it("recognizes every address a minted demo generates", () => {
    const identity = generateDemoShopIdentity();
    for (const local of ["dana", "marcus", "keiko", "sal"]) {
      expect(isDemoAccountEmail(identity.emailFor(local))).toBe(true);
    }
  });

  it("is case-insensitive on the domain", () => {
    expect(isDemoAccountEmail(`owner@DEMO.INVALID`)).toBe(true);
    expect(isDemoAccountEmail(`owner@Coral-Cove.Demo.Invalid`)).toBe(true);
  });

  it("rejects routable addresses — no real shop can ever be in the namespace", () => {
    expect(isDemoAccountEmail("owner@realshop.example.com")).toBe(false);
    expect(isDemoAccountEmail("dana@gmail.com")).toBe(false);
  });

  it("rejects lookalikes of the reserved domain", () => {
    expect(isDemoAccountEmail(`owner@${DEMO_EMAIL_DOMAIN}.example.com`)).toBe(false);
    expect(isDemoAccountEmail("owner@notdemo.invalid")).toBe(false);
    expect(isDemoAccountEmail("owner@xdemo.invalid")).toBe(false);
    expect(isDemoAccountEmail("owner@invalid")).toBe(false);
  });

  it("rejects malformed input rather than guessing", () => {
    expect(isDemoAccountEmail("")).toBe(false);
    expect(isDemoAccountEmail(DEMO_EMAIL_DOMAIN)).toBe(false);
    expect(isDemoAccountEmail(`@${DEMO_EMAIL_DOMAIN}`)).toBe(false);
  });
});
