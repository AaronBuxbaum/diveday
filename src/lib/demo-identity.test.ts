import { describe, expect, it } from "vitest";
import { generateDemoShopIdentity } from "./demo-identity";

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
