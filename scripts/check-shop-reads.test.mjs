import { describe, expect, it } from "vitest";
import { shellProblems, shopReadProblems, storefrontShopReads } from "./check-shop-reads.mjs";

describe("shopReadProblems", () => {
  it("refuses the unmemoized read on a render path", () => {
    expect(
      shopReadProblems("src/app/s/[shopSlug]/page.tsx", "await getShopBySlug(db, slug)"),
    ).toHaveLength(1);
    expect(
      shopReadProblems("src/app/s/[shopSlug]/page.tsx", "await shopBySlugCached(slug)"),
    ).toEqual([]);
  });

  it("lets a route, an image and an action read without the memo", () => {
    for (const file of ["x/route.ts", "x/route.tsx", "x/opengraph-image.tsx", "x/actions.ts"]) {
      expect(shopReadProblems(file, "getShopBySlug(db, slug)")).toEqual([]);
    }
  });

  it("keeps the memo out of an action, where a stale row is a wrong answer", () => {
    expect(shopReadProblems("x/actions.ts", "shopBySlugCached(slug)")).toHaveLength(1);
  });
});

describe("shellProblems", () => {
  it("wants exactly the three shell readers on the memo", () => {
    expect(shellProblems("shopBySlugCached( shopBySlugCached( shopBySlugCached(")).toEqual([]);
    expect(shellProblems("shopBySlugCached( shopBySlugCached(")).toHaveLength(1);
  });
});

describe("the storefront as it stands", () => {
  it("reads the shop through one memo on every render path", async () => {
    expect((await storefrontShopReads()).problems).toEqual([]);
  });
});
