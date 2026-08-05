import { describe, expect, it } from "vitest";
import { DEV_STAFF_LOGINS } from "@/db/dev-credentials";
import {
  DEMO_EMAIL_DOMAIN,
  DEMO_NAME_COMBINATIONS,
  generateDemoShopIdentity,
  isDemoAccountEmail,
} from "./demo-identity";

describe("generateDemoShopIdentity", () => {
  it("produces a URL-safe slug and a matching display name", () => {
    const { name, slug } = generateDemoShopIdentity();
    expect(slug).toMatch(/^[a-z0-9-]+$/);
    // The onboarding slug rule (max 50) also comfortably holds here.
    expect(slug.length).toBeLessThanOrEqual(50);
    // The slug *is* the name, lowercased and hyphenated — nothing appended.
    expect(slug).toBe(name.toLowerCase().replace(/\s+/g, "-"));
  });

  it("leaves no generated token in the name a visitor is shown", () => {
    for (let i = 0; i < 200; i += 1) {
      const { slug } = generateDemoShopIdentity();
      // The old shape was `<adjective>-<noun>-divers-a1b2c3`. A trailing hex
      // blob is exactly what this change removed from the demo's URL and from
      // the sign-in address printed in the demo banner.
      expect(slug).not.toMatch(/-[0-9a-f]{6}$/);
    }
  });

  it("never repeats a word ('Reef Reef Divers')", () => {
    for (let i = 0; i < 500; i += 1) {
      const [adjective, noun] = generateDemoShopIdentity().slug.split("-");
      expect(adjective).not.toBe(noun);
    }
  });

  it("offers more than 10,000 names, so collisions stay rare without a suffix", () => {
    expect(DEMO_NAME_COMBINATIONS).toBeGreaterThan(10_000);
  });

  it("actually reaches a wide spread of that space in practice", () => {
    // Guards the generator itself, not the arithmetic above: a pick() that
    // silently stopped varying would still satisfy the constant.
    const slugs = new Set(Array.from({ length: 500 }, () => generateDemoShopIdentity().slug));
    expect(slugs.size).toBeGreaterThan(400);
  });

  it("namespaces staff emails under the slug", () => {
    const identity = generateDemoShopIdentity();
    expect(identity.emailFor("dana")).toBe(`dana@${identity.slug}.demo.invalid`);
    expect(identity.emailFor("marcus")).toBe(`marcus@${identity.slug}.demo.invalid`);
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
