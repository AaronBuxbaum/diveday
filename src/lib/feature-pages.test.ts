import { describe, expect, it } from "vitest";
import enUS from "@/i18n/locales/en-US/diver.json";
import { staffDestinationGates } from "./authz";
import {
  FEATURE_PAGE_SLUGS,
  FEATURE_PAGES,
  FEATURE_PHASES,
  featurePagePath,
  featurePagesIn,
  getFeaturePage,
  relatedFeaturePages,
} from "./feature-pages";
import { capabilityGroup, hubOnlyCapabilityGroups, productCapabilityIndex } from "./marketing";
import { visibleStaffDestinations } from "./staff-destinations";

describe("the feature page registry", () => {
  it("holds one page per slug, in the slug list's order", () => {
    expect(FEATURE_PAGES.map((page) => page.slug)).toEqual([...FEATURE_PAGE_SLUGS]);
    expect(new Set(FEATURE_PAGES.map((page) => page.key)).size).toBe(FEATURE_PAGES.length);
    expect(new Set(FEATURE_PAGES.map((page) => page.screen)).size).toBe(FEATURE_PAGES.length);
  });

  it("finds a page by its slug and nothing off the list", () => {
    for (const slug of FEATURE_PAGE_SLUGS) expect(getFeaturePage(slug)?.slug).toBe(slug);
    for (const stranger of ["kiosk", "Waivers", "waivers/", "", "constructor", "__proto__"]) {
      expect(getFeaturePage(stranger)).toBeUndefined();
    }
  });

  it("puts every page at /product/<slug>", () => {
    expect(featurePagePath("rental-gear")).toBe("/product/rental-gear");
  });

  it("files every page under exactly one phase, and leaves no phase empty", () => {
    const filed = FEATURE_PHASES.flatMap((phase) => featurePagesIn(phase));
    expect(filed.map((page) => page.slug).sort()).toEqual([...FEATURE_PAGE_SLUGS].sort());
    for (const phase of FEATURE_PHASES) expect(featurePagesIn(phase).length).toBeGreaterThan(0);
  });

  it.each(FEATURE_PAGES)("links $slug to three other pages that exist", (page) => {
    const related = relatedFeaturePages(page);
    expect(related).toHaveLength(3);
    expect(new Set(related.map(({ slug }) => slug)).size).toBe(3);
    expect(related.map(({ slug }) => slug)).not.toContain(page.slug);
  });

  it.each(FEATURE_PAGES.filter((page) => page.demo.landing !== null))(
    "opens $slug's demo on a page its role is let into",
    (page) => {
      // A door that lands a role on a page that role's gate refuses would greet
      // the visitor with a refusal instead of the thing the page was about.
      expect(page.demo.role).not.toBe("diver");
      const sees = visibleStaffDestinations(staffDestinationGates([page.demo.role])).map(
        ({ id }) => id,
      );
      expect(sees).toContain(page.demo.landing);
    },
  );

  it("sends a diver door to the public schedule, which names no staff page", () => {
    for (const page of FEATURE_PAGES.filter(({ demo }) => demo.role === "diver")) {
      expect(page.demo.landing).toBeNull();
    }
  });
});

describe("each feature page's copy and checklist", () => {
  const pages = enUS.marketing.featurePages as Record<string, Record<string, string>>;
  const fields = Object.keys(pages.onlineBooking);

  it.each(FEATURE_PAGES)("gives $slug the same fields as every other page", (page) => {
    // One template renders all twelve, so a page with a field the others lack
    // is a section nobody will see, and one missing a field renders a key.
    expect(Object.keys(pages[page.key] ?? {})).toEqual(fields);
  });

  it("has no copy for a page the registry does not hold", () => {
    expect(Object.keys(pages).sort()).toEqual(FEATURE_PAGES.map(({ key }) => key).sort());
  });

  it.each(FEATURE_PAGES)("gives $slug a checklist of its own, titled with its name", (page) => {
    const group = capabilityGroup(page.key);
    expect(group.title).toBe(`marketing.featurePages.${page.key}.name`);
    expect(group.items.length).toBeGreaterThanOrEqual(5);
  });

  it("lists every line of the index once", () => {
    const lines = productCapabilityIndex.flatMap(({ items }) => items);
    expect(new Set(lines).size).toBe(lines.length);
  });

  // The hub draws a group under each feature page's row and the hub-only
  // groups after them, and nothing else: a group outside both would be in
  // the index and on no page at all.
  it("files every group of the index under a feature page or the hub's own rows", () => {
    expect(productCapabilityIndex.map(({ id }) => id).sort()).toEqual(
      [...FEATURE_PAGES.map(({ key }) => key), ...hubOnlyCapabilityGroups].sort(),
    );
  });
});
