import { describe, expect, it } from "vitest";
import { browserFallbacks, expandBrowserFallback } from "./browser-impact-safety.mjs";

describe("browser boundary safety", () => {
  it.each([
    "src/db/schema/people.ts",
    "src/db/seed-trips.ts",
    "src/db/queries.ts",
    "src/app/api/checkin/route.ts",
    "playwright.config.ts",
    "pnpm-lock.yaml",
    "public/new.svg",
  ])("expands uncertain %s", (file) => {
    expect(browserFallbacks({ changed: [file], selected: 0 })).not.toEqual([]);
  });
  it("leaves mapped app changes and documentation alone", () => {
    expect(
      browserFallbacks({ changed: ["src/features/trips/view.tsx", "docs/design.md"], selected: 2 }),
    ).toEqual([]);
  });
  it("does not mistake one mapped change for a safe deleted input", () => {
    expect(
      browserFallbacks({ changed: ["src/deleted.ts"], selected: 2, existing: () => false })[0],
    ).toContain("deleted");
  });
  it("does not hide unmapped input behind another mapped edit", () => {
    expect(
      browserFallbacks({
        changed: ["public/new.svg", "e2e/booking.spec.ts"],
        selected: 1,
      }),
    ).not.toEqual([]);
  });
  it("keeps strong tests and excludes separate visual/tool pipelines", () => {
    const selection = {
      strong: new Map([["a", new Set(["edited"])]]),
      reach: new Map(),
      rank: new Map(),
    };
    expandBrowserFallback(
      selection,
      new Map([
        ["a", ""],
        ["b", ""],
        ["visual", ""],
      ]),
      ["global"],
      (spec) => spec === "visual",
    );
    expect([...selection.reach.keys()]).toEqual(["b"]);
    expect([...selection.strong.get("a")]).toEqual(["edited"]);
  });
});
