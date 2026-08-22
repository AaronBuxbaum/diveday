import { describe, expect, it } from "vitest";
import { DEV_STAFF_LOGINS } from "@/db/dev-credentials";
import {
  DEMO_EMAIL_DOMAIN,
  DEMO_NAME_COMBINATIONS,
  generateDemoShopIdentity,
  isDemoAccountEmail,
  pinnedDemoShopIdentity,
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

/**
 * **The identity a visual capture can rely on.**
 *
 * `generateDemoShopIdentity` is random by design, and both halves of what it
 * picks reach the screen: the name in the staff header, the slug in the owner
 * email the dev banner prints. So the first capture to photograph a minted shop
 * (`manifest-emergency-empty`) reported as changed on the very next pull
 * request — "Verdant Trench Dive Co" against "Verdant Lagoon Dive Center" —
 * with nothing about the page different.
 */
describe("pinnedDemoShopIdentity", () => {
  it("returns the same identity every time, which is the whole point", () => {
    // Compared by what it *renders*, not by object identity: `emailFor` is a
    // fresh closure per call and always will be, so a `toEqual` on the whole
    // object fails for a reason that has nothing to do with the guarantee.
    const rendered = (slug: string) => {
      const identity = pinnedDemoShopIdentity(slug);
      return [identity.name, identity.slug, identity.emailFor("dana")];
    };
    expect(rendered("harbour-lantern-dive-co")).toEqual(rendered("harbour-lantern-dive-co"));
  });

  it("titles the name from the slug, so the two can never disagree", () => {
    const identity = pinnedDemoShopIdentity("harbour-lantern-dive-co");
    expect(identity.slug).toBe("harbour-lantern-dive-co");
    expect(identity.name).toBe("Harbour Lantern Dive Co");
  });

  it("namespaces staff email on the slug, the same way a random identity does", () => {
    // A shared domain would let one minted shop's owner sign in as another's,
    // which is the invariant `emailFor` carries in both paths.
    expect(pinnedDemoShopIdentity("harbour-lantern-dive-co").emailFor("dana")).toBe(
      "dana@harbour-lantern-dive-co.demo.invalid",
    );
  });

  it("produces the shape a random identity produces", () => {
    // Not a snapshot of the words — a claim that a pinned identity is
    // interchangeable with a generated one everywhere it is used.
    const pinned = pinnedDemoShopIdentity("coral-cove-divers");
    const generated = generateDemoShopIdentity();
    expect(Object.keys(pinned).sort()).toEqual(Object.keys(generated).sort());
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
