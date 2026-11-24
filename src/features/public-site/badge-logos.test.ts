import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BADGE_LOGOS } from "@/features/public-site/badge-logos";
import { BRAND_BADGE_CODES } from "@/lib/brand";

const badges = join(process.cwd(), "public/badges");
const sources = readFileSync(join(badges, "SOURCES.md"), "utf8");

describe("badge logos", () => {
  it("names only codes the badge wall knows", () => {
    for (const code of Object.keys(BADGE_LOGOS)) {
      expect(BRAND_BADGE_CODES as readonly string[]).toContain(code);
    }
  });

  it("ships every mapped file, and records where each came from", () => {
    for (const [code, logo] of Object.entries(BADGE_LOGOS)) {
      expect(existsSync(join(process.cwd(), "public", logo?.src ?? "missing")), code).toBe(true);
      // The manifest row for a file names its source URL and the day it was taken.
      const row = sources.split("\n").find((line) => line.includes(logo?.src ?? "missing"));
      expect(row, `${code} has no row in public/badges/SOURCES.md`).toMatch(/https:\/\/\S+/);
      expect(row, `${code} row has no date`).toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });

  it("leaves no file in public/badges that no code uses", () => {
    const mapped = Object.values(BADGE_LOGOS).map((logo) => logo?.src.split("/").pop());
    for (const file of readFileSync(join(badges, "SOURCES.md"), "utf8").matchAll(
      /\/badges\/(\S+?)`/g,
    )) {
      expect(mapped).toContain(file[1]);
    }
  });
});
