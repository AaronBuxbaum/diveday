import { describe, expect, it } from "vitest";
import speciesCoverage from "./species-coverage.json";

const groups = speciesCoverage.groups as {
  group: string;
  rows: { name: string; slug: string | null }[];
}[];

describe("the species denominators' rows", () => {
  it("count a species once, in one group", () => {
    const seen = new Map<string, string>();
    const twice = groups.flatMap((group) =>
      group.rows.flatMap((row) => {
        if (!row.slug) return [];
        const earlier = seen.get(row.slug);
        seen.set(row.slug, group.group);
        return earlier ? [`${row.slug}: ${earlier} and ${group.group}`] : [];
      }),
    );
    expect(twice).toEqual([]);
  });

  it("never carry a blank common name", () => {
    const blank = groups.flatMap((group) =>
      group.rows
        .filter((row) => !/^[A-Za-z]/.test(row.name))
        .map((row) => `${group.group}: ${row.name}`),
    );
    expect(blank).toEqual([]);
  });
});
