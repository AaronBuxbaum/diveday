import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type CoverageDenominator, coverageOf, coverageProblems } from "./coverage";
import { DIVE_AREA_BY_CODE } from "./dive-areas";
import { DIVE_SITE_TEMPLATES } from "./dive-site-templates";

const DIR = path.join(process.cwd(), "src", "content", "coverage");
const denominators: CoverageDenominator[] = readdirSync(DIR)
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(readFileSync(path.join(DIR, file), "utf8")));

const site = (name: string, template: string | null, excluded?: string) => ({
  name,
  template,
  ...(excluded ? { excluded } : {}),
});

describe("coverageOf", () => {
  it("counts defined sites against the listed ones, leaving exclusions out of both", () => {
    const coverage = coverageOf({
      area: "florida-keys-upper",
      method: "",
      sources: [],
      counted: "2026-10-14",
      promised: false,
      sites: [site("A", "a"), site("B", null), site("C", "c"), site("D", null, "closed to diving")],
    });
    expect(coverage).toMatchObject({ counted: 3, defined: 2, missing: ["B"] });
  });
});

describe("the coverage denominators", () => {
  it("name a real area and real templates in it, and keep every promise", () => {
    const problems = denominators.flatMap((denominator) => [
      ...(DIVE_AREA_BY_CODE.has(denominator.area) ? [] : [`${denominator.area}: no such area`]),
      ...coverageProblems(denominator, DIVE_SITE_TEMPLATES),
    ]);
    expect(problems).toEqual([]);
  });

  it("cite at least two sources and say how they were counted", () => {
    const thin = denominators
      .filter((denominator) => denominator.sources.length < 2 || denominator.method.length < 40)
      .map((denominator) => denominator.area);
    expect(thin).toEqual([]);
  });
});
