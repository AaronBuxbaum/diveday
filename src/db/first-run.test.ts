import { describe, expect, it } from "vitest";
import { DEFAULT_WAIVER_BODY } from "@/lib/waivers";
import { fileScopedShopContext } from "@/test/db";
import { loadFirstRunFacts } from "./first-run";
import { saveWaiverTemplate } from "./waivers-templates";

const ctx = fileScopedShopContext();

const BARE = {
  contactEmail: null,
  contactPhone: null,
  tagline: null,
  description: null,
  logoUrl: null,
  unitsConfirmedAt: null,
};

describe("loadFirstRunFacts", () => {
  it("counts the release as done only once it is the shop's own words", async () => {
    const { db, shop } = ctx;
    await saveWaiverTemplate(db, { shopId: shop.id, body: DEFAULT_WAIVER_BODY, material: true });
    const sample = await loadFirstRunFacts(db, { id: shop.id, ...BARE }, null);
    expect(sample.steps.releaseDone).toBe(false);

    await saveWaiverTemplate(db, {
      shopId: shop.id,
      body: "Our own release, in our own words.",
      material: true,
    });
    const own = await loadFirstRunFacts(db, { id: shop.id, ...BARE }, null);
    expect(own.steps.releaseDone).toBe(true);
    expect(own.doneCount - sample.doneCount).toBe(1);
  });

  it("reads the shop row's steps and leaves the guided rows out of the count", async () => {
    const { db, shop } = ctx;
    await saveWaiverTemplate(db, { shopId: shop.id, body: DEFAULT_WAIVER_BODY, material: true });
    const facts = await loadFirstRunFacts(
      db,
      {
        ...BARE,
        id: shop.id,
        contactEmail: "desk@example.com",
        tagline: "Reef days",
        unitsConfirmedAt: shop.createdAt,
      },
      null,
    );
    expect(facts.steps).toMatchObject({
      contactDone: true,
      profileDone: true,
      unitsDone: true,
      releaseDone: false,
      stripeDone: false,
    });
    const siteStep = facts.steps.diveSiteCount > 0 ? 1 : 0;
    expect(facts.doneCount).toBe(3 + siteStep);
  });
});
