import { describe, expect, it } from "vitest";
import { DEFAULT_WAIVER_BODY } from "@/lib/waivers";
import { fileScopedShopContext } from "@/test/db";
import { liveReleaseIsSample, loadFirstRunFacts } from "./first-run";
import { saveWaiverTemplate } from "./waivers-templates";

const ctx = fileScopedShopContext();

const BARE = {
  contactEmail: null,
  contactPhone: null,
  tagline: null,
  description: null,
  logoUrl: null,
  unitsConfirmedAt: null,
  emergencyReference: { lines: [], vessel: "", shoreContact: "", plan: "" },
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
      emergencyDone: false,
      stripeDone: false,
    });
    const siteStep = facts.steps.diveSiteCount > 0 ? 1 : 0;
    expect(facts.doneCount).toBe(3 + siteStep);
  });

  it("counts the emergency card done once it carries a number to dial", async () => {
    const { db, shop } = ctx;
    const facts = await loadFirstRunFacts(
      db,
      {
        ...BARE,
        id: shop.id,
        emergencyReference: {
          ...BARE.emergencyReference,
          lines: [{ label: "Chamber", phone: "+1 305 555 0177" }],
        },
      },
      null,
    );
    expect(facts.steps.emergencyDone).toBe(true);
  });
});

/** The release step outlives first run on Today (fourth UX review, item 21). */
describe("liveReleaseIsSample", () => {
  it("is true while divers sign the sample, and false once the shop's own words are live", async () => {
    const { db, shop } = ctx;
    await saveWaiverTemplate(db, { shopId: shop.id, body: DEFAULT_WAIVER_BODY, material: true });
    expect(await liveReleaseIsSample(db, shop.id)).toBe(true);
    await saveWaiverTemplate(db, { shopId: shop.id, body: "Our own words.", material: true });
    expect(await liveReleaseIsSample(db, shop.id)).toBe(false);
  });
});
