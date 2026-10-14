import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COVERAGE_PROMISE, type CoverageDenominator, coverageOf, coverageProblems } from "./coverage";
import { DIVE_AREA_BY_CODE } from "./dive-areas";
import { MARINE_LIFE_BY_SLUG } from "@/db/marine-life-catalog";
import { DIVE_SITE_TEMPLATES } from "./dive-site-templates";
import speciesCoverage from "./species-coverage.json";

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

/**
 * The species half of the promise: every group in `./species-coverage.json`
 * (fish from REEF survey frequencies, everything else from iNaturalist
 * observation counts) is held at 80% too, and every row it maps names a
 * species the catalog really carries.
 */
describe("the species denominators", () => {
  const groups = speciesCoverage.groups as {
    group: string;
    rows: { name: string; slug: string | null; excluded?: string }[];
  }[];

  it("map only to species the catalog carries", () => {
    const unknown = groups.flatMap((group) =>
      group.rows
        .filter((row) => row.slug && !MARINE_LIFE_BY_SLUG.has(row.slug))
        .map((row) => `${group.group}: ${row.slug}`),
    );
    expect(unknown).toEqual([]);
  });

  it("keep every group at 80% or more", () => {
    const below = groups.flatMap((group) => {
      const counted = group.rows.filter((row) => !row.excluded);
      const defined = counted.filter((row) => row.slug).length;
      return defined / counted.length < COVERAGE_PROMISE
        ? [`${group.group}: ${defined} of ${counted.length}`]
        : [];
    });
    expect(below).toEqual([]);
  });
});
