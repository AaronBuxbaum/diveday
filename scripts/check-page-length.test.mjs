import { describe, expect, it } from "vitest";

import {
  comparePageLengths,
  countLines,
  growthAgainst,
  nextBaseline,
  PAGE_LINE_LIMIT,
} from "./check-page-length.mjs";

const page = "src/app/shop/[shopSlug]/x/page.tsx";

describe("counting lines", () => {
  it("counts lines the way an editor numbers them", () => {
    expect(countLines("a\nb\nc\n")).toBe(3);
    expect(countLines("a\nb\nc")).toBe(3);
    expect(countLines("")).toBe(0);
  });
});

describe("what it refuses", () => {
  it("refuses a new page over the limit", () => {
    const violations = comparePageLengths(new Map([[page, PAGE_LINE_LIMIT + 1]]), {});
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("over the 400-line limit");
  });

  it("refuses a banked page that grew", () => {
    const violations = comparePageLengths(new Map([[page, 900]]), { [page]: 899 });
    expect(violations[0]).toContain("baseline allows 899");
  });

  it("refuses a banked page that shrank until the fall is banked", () => {
    const violations = comparePageLengths(new Map([[page, 700]]), { [page]: 899 });
    expect(violations[0]).toContain("--write");
  });

  it("refuses a baseline entry for a page that no longer exists", () => {
    const violations = comparePageLengths(new Map(), { [page]: 899 });
    expect(violations[0]).toContain("gone");
  });
});

describe("what it leaves alone", () => {
  it("leaves a page at or under the limit alone", () => {
    expect(comparePageLengths(new Map([[page, PAGE_LINE_LIMIT]]), {})).toEqual([]);
    expect(comparePageLengths(new Map([[page, 12]]), {})).toEqual([]);
  });

  it("leaves a banked page at exactly its banked count alone", () => {
    expect(comparePageLengths(new Map([[page, 899]]), { [page]: 899 })).toEqual([]);
  });
});

describe("writing the baseline", () => {
  it("banks only pages over the limit, sorted by path", () => {
    const counts = new Map([
      ["src/app/b/page.tsx", 500],
      ["src/app/a/page.tsx", 401],
      ["src/app/c/page.tsx", 400],
    ]);
    expect(Object.keys(nextBaseline(counts))).toEqual(["src/app/a/page.tsx", "src/app/b/page.tsx"]);
  });

  it("names a rise and a newcomer as growth, and a fall as none", () => {
    const baseline = { "src/app/a/page.tsx": 450, "src/app/b/page.tsx": 600 };
    const next = {
      "src/app/a/page.tsx": 460,
      "src/app/b/page.tsx": 500,
      "src/app/c/page.tsx": 401,
    };
    expect(growthAgainst(next, baseline).map(([file]) => file)).toEqual([
      "src/app/a/page.tsx",
      "src/app/c/page.tsx",
    ]);
  });
});
