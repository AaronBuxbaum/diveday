import { describe, expect, it } from "vitest";

import { containerWidth, SKELETON_EXEMPT } from "./check-loading-skeletons.mjs";

describe("containerWidth", () => {
  it("reads the width off the container idiom every page-owned <main> uses", () => {
    expect(
      containerWidth(
        '<main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">',
      ),
    ).toBe("max-w-4xl");
  });

  it("reads it out of a ternary, where the embed variant puts the class mid-expression", () => {
    // src/app/s/[shopSlug]/trips/[id]/page.tsx: the non-embed branch owns the
    // width, and it is not the first string in the attribute.
    expect(
      containerWidth(
        'isEmbed ? "w-full flex-1 px-3 py-4" : "mx-auto w-full max-w-2xl flex-1 px-6 py-16"',
      ),
    ).toBe("max-w-2xl");
  });

  it("keeps a print variant out of the answer", () => {
    expect(
      containerWidth('"mx-auto w-full max-w-5xl flex-1 px-6 py-10 print:max-w-none print:px-10"'),
    ).toBe("max-w-5xl");
  });

  it("is null for a page whose layout owns the container", () => {
    // The trip family: `layout.tsx` holds the <main>, pages render into it.
    expect(containerWidth('<div className="animate-pulse">')).toBeNull();
  });

  it("is null for a page that delegates its container to a component", () => {
    // src/app/shop/[shopSlug]/settings/page.tsx is a re-export; the width
    // lives in SettingsPage.tsx, which this check deliberately does not follow.
    expect(containerWidth('export { default, metadata } from "./SettingsPage";')).toBeNull();
  });

  it("ignores a max-w on an inner element that is not the container", () => {
    // The shape that made two routes look like width mismatches when they were
    // not: a SectionCard and a prose paragraph, neither of them the page's
    // container.
    expect(containerWidth('<SectionCard as="div" padding="lg" className="max-w-2xl">')).toBeNull();
    expect(containerWidth('<p className="mt-3 max-w-prose text-sm text-muted">')).toBeNull();
  });
});

describe("SKELETON_EXEMPT", () => {
  it("covers exactly the routes with no ancestor boundary to fall back to", () => {
    expect(Object.keys(SKELETON_EXEMPT).sort()).toEqual([
      ".",
      "offline-manifest",
      "sign-in",
      "switching",
      "switching/[competitor]",
    ]);
  });

  it("states a reason for each, since an exemption nobody can weigh is one nobody removes", () => {
    for (const [route, reason] of Object.entries(SKELETON_EXEMPT)) {
      expect(reason, route).toMatch(/\w+\s+\w+/);
    }
  });
});
