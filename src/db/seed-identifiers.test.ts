import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEMO_RECAP_BOOKING_ID,
  LISTED_SHOP_SLUGS,
  MINTED_DEMO_BRAND_COLOR,
} from "./seed-identifiers";

const root = path.resolve(__dirname, "../..");

describe("browser seed identifiers", () => {
  it("preserves the pinned links, listed shops and branded colour", () => {
    expect(DEMO_RECAP_BOOKING_ID).toBe("0de3c0de-1eaf-4b0a-9c0f-000000000001");
    expect(LISTED_SHOP_SLUGS).toEqual(["reef-line-divers", "keys-current-charters"]);
    expect(MINTED_DEMO_BRAND_COLOR).toBe("#158462");
  });

  it("keeps browser discovery from loading the seed graph for constants", () => {
    const identifiers = readFileSync(path.join(__dirname, "seed-identifiers.ts"), "utf8");
    expect(identifiers).not.toMatch(/^\s*import\b|\bfrom\s+["']|\bimport\s*\(/m);
    const visualSpecs = readdirSync(path.join(root, "e2e"))
      .filter((file) => /^visual-.+\.spec\.ts$/.test(file))
      .map((file) => file.replace(/\.spec\.ts$/, ""));
    expect(visualSpecs.length).toBeGreaterThan(0);
    for (const spec of ["recap", "reviews", "review-replies", "storefront-brand", ...visualSpecs]) {
      const source = readFileSync(path.join(root, "e2e", `${spec}.spec.ts`), "utf8");
      expect(source, spec).not.toMatch(/from\s+["']\.\.\/src\/db\/(?:seed|seed-listed-shops)["']/);
    }
  });
});
