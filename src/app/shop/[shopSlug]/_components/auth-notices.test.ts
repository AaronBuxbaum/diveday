import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sayWords } from "@/i18n/shared-sentences";
import { staffTranslator } from "@/i18n/staff-messages";
import { LANDED_REFUSAL_NOTICES, TODAY_REFUSAL_NOTICES } from "@/lib/staff-notices";
import { AUTH_NOTICES } from "./auth-notices";

/**
 * **A staff refusal code always has words** (issue #2708). `requireShopSurface`
 * types `refusal.notice` to `TodayRefusalNotice | LandedRefusalNotice`; these
 * tests are the runtime half of that promise, so a code added to either list
 * without a sentence fails here rather than rendering a blank banner.
 */

describe("the refusals that land on Today", () => {
  it("map exactly the listed codes, no more and no fewer", () => {
    expect(Object.keys(AUTH_NOTICES).sort()).toEqual([...TODAY_REFUSAL_NOTICES].sort());
  });

  for (const locale of ["en-US", "es-ES"] as const) {
    it(`say a sentence for every code in ${locale}`, () => {
      const t = staffTranslator(locale);
      for (const code of TODAY_REFUSAL_NOTICES) {
        const words = sayWords(t, AUTH_NOTICES[code]);
        expect(words.length, code).toBeGreaterThan(10);
        expect(words, code).not.toMatch(/^[a-z]+(\.[A-Za-z]+)+$/);
      }
    });
  }
});

/** Every `.ts`/`.tsx` source under `dir`. */
function sourcesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const here = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourcesUnder(here);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [here] : [];
  });
}

describe("the refusals that name a landing", () => {
  // The surfaces' own maps, some of which live in `src/lib` (`diver-notices.ts`).
  const sources = ["src/app/shop", "src/lib"]
    .flatMap((dir) => sourcesUnder(path.join(process.cwd(), dir)))
    .map((file) => readFileSync(file, "utf8"));

  it("are each worded as a key of some surface's own notice map (staff pages or src/lib)", () => {
    for (const code of LANDED_REFUSAL_NOTICES) {
      const worded = sources.some((source) => new RegExp(`"${code}"\\s*:`).test(source));
      expect(worded, `${code} has no words on any staff surface`).toBe(true);
    }
  });
});
