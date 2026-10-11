import { describe, expect, it } from "vitest";

import { adrSummary, END, indexTable, START, withIndex } from "./adr-index.mjs";
import { adrProblems, adrWords, isCapped, WORD_CAP } from "./check-adrs.mjs";

const adr = (id, { status = "Accepted", body = "Short." } = {}) =>
  [
    `# ${id} — Use a thing`,
    "",
    `- **Status:** ${status}`,
    "- **Date:** 2026-10-11",
    "",
    "## Context",
    "",
    body,
    "",
    "## Decision",
    "",
    "## Alternatives considered",
    "",
    "## Consequences",
  ].join("\n");

describe("the ADR word cap", () => {
  it("holds a new ADR to the cap and leaves the older corpus alone", () => {
    const long = "word ".repeat(WORD_CAP + 1);
    expect(isCapped("20261011-new-thing")).toBe(true);
    expect(isCapped("20261010-today")).toBe(false);
    expect(isCapped("0001-nextjs-fullstack")).toBe(false);
    const [problem] = adrProblems(
      "20261011-new-thing.md",
      adr("20261011-new-thing", { body: long }),
    ).failures;
    expect(problem).toMatch(/words; an ADR dated after 20261010 holds at most 500/);
    expect(adrProblems("20261009-old.md", adr("20261009-old", { body: long })).failures).toEqual(
      [],
    );
  });

  it("does not count the template's HTML guidance", () => {
    expect(adrWords("one <!-- a long\nguidance comment here --> two")).toBe(2);
  });

  it("keeps the shape checks it always had", () => {
    expect(adrProblems("20261011-x.md", "# 20261011-x — T\n").failures.join("\n")).toMatch(
      /status must begin with[\s\S]*missing ISO Date[\s\S]*missing section “Context”/,
    );
  });
});

describe("the generated index", () => {
  const known = new Set(["20260801-old", "20260901-new"]);

  it("reads title, status and the successor named in the status line", () => {
    expect(
      adrSummary(
        "20260801-old.md",
        adr("20260801-old", {
          status: "Superseded on 2026-09-20 by [20260901-new](20260901-new.md)",
        }),
        known,
      ),
    ).toEqual({
      id: "20260801-old",
      title: "Use a thing",
      status: "Superseded",
      supersededBy: "20260901-new",
    });
    expect(
      adrSummary("x.md", adr("x", { status: "Superseded by 20260901-new" }), known).supersededBy,
    ).toBe("20260901-new");
    expect(adrSummary("x.md", adr("x"), known).supersededBy).toBe("");
  });

  it("writes one row per ADR between the markers and leaves the rest of the README alone", () => {
    const table = indexTable([
      { id: "0001-a", title: "A | B", status: "Accepted", supersededBy: "" },
      { id: "0002-b", title: "B", status: "Superseded", supersededBy: "0003-c" },
    ]);
    expect(table.split("\n")).toEqual([
      "| ADR | Decision | Status | Superseded by |",
      "| --- | --- | --- | --- |",
      "| [0001-a](0001-a.md) | A \\| B | Accepted |  |",
      "| [0002-b](0002-b.md) | B | Superseded | [0003-c](0003-c.md) |",
    ]);
    const readme = `# ADRs\n\nprose\n\n${START}\nold\n${END}\n\ntail\n`;
    const next = withIndex(readme, "T");
    expect(next).toBe(`# ADRs\n\nprose\n\n${START}\n\nT\n\n${END}\n\ntail\n`);
    expect(withIndex(next, "T")).toBe(next);
    expect(withIndex("# no markers", "T")).toBeNull();
  });
});
