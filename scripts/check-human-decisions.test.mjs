import { describe, expect, it } from "vitest";

import {
  citationProblems,
  decisionProblems,
  decisionSummary,
  END,
  indexTable,
  START,
  withIndex,
} from "./check-human-decisions.mjs";

// Fixture ids are assembled from parts so this file never carries a citation of its own.
const id = (day, slug) => ["H", day, slug].join("-");
const A = id("20261017", "seat-hold-window");
const B = id("20261018", "dock-fee-quote");

const file = (name, heading, status = "Chosen") => ({
  name: `${name}.md`,
  contents: `# ${heading}: A question?\n\n- **Status:** ${status}\n- **Human owner:** Product owner\n\nDecided 2026-10-17.\n`,
});

describe("a decision file", () => {
  it("passes when the file name, heading and status agree", () => {
    expect(decisionProblems([file(A, A), file(B, B)])).toEqual([]);
  });

  it("refuses an old-style numbered file name", () => {
    const problems = decisionProblems([file("H-07-payment-deposit", "H-07")]);
    expect(problems.join("\n")).toMatch(/not a date-slug id/);
  });

  it("refuses a heading that names another id", () => {
    expect(decisionProblems([file(A, B)]).join("\n")).toMatch(/heading names/);
  });

  it("refuses two files that claim the same id in their headings", () => {
    const problems = decisionProblems([file(A, A), file(B, A)]).join("\n");
    expect(problems).toMatch(/duplicate/);
  });

  it("refuses a file with no status line", () => {
    const bare = { name: `${A}.md`, contents: `# ${A}: A question?\n` };
    expect(decisionProblems([bare]).join("\n")).toMatch(/Status/);
  });
});

describe("a citation", () => {
  const known = new Set([A, B]);
  const lines = (text) => [{ file: "docs/x.md", text }];

  it("accepts a known id, in prose, a link and a possessive", () => {
    expect(
      citationProblems(lines(`Per ${A}, see [it](../${B}.md) and ${A}'s rule.`), known),
    ).toEqual([]);
  });

  it("refuses an old-style numbered id", () => {
    const problems = citationProblems(lines("Per H-49, delete it."), known);
    expect(problems.join("\n")).toMatch(/old-style id H-49/);
  });

  it("refuses an id that names no decision file", () => {
    const missing = id("20261019", "nothing-here");
    expect(citationProblems(lines(`See ${missing}.`), known).join("\n")).toMatch(/dangling/);
  });

  it("leaves a placeholder, a verification id and other words alone", () => {
    const text = "An id looks like H-YYYYMMDD-slug; see V-02, the NH-4 part, and h-08 in a class.";
    expect(citationProblems(lines(text), known)).toEqual([]);
  });

  it("names the file and line of the offender", () => {
    const rows = [{ file: "src/a.ts", line: 12, text: "// H-3 says so" }];
    expect(citationProblems(rows, known)[0]).toMatch(/src\/a\.ts:12/);
  });
});

describe("the index", () => {
  const summaries = [
    decisionSummary(`${A}.md`, file(A, A, "Implemented").contents),
    decisionSummary(`${B}.md`, file(B, B, "Ready").contents),
  ];

  it("reads id, status, last date and question from a file", () => {
    expect(summaries[0]).toEqual({
      id: A,
      status: "Implemented",
      last: "2026-10-17",
      title: "A question?",
    });
  });

  it("writes one row per decision, sorted by id", () => {
    const table = indexTable([summaries[1], summaries[0]]).split("\n");
    expect(table[0]).toBe("| ID | Status | Last dated | Decision |");
    expect(table.slice(2)).toEqual([
      `| ${A} | Implemented | 2026-10-17 | A question? |`,
      `| ${B} | Ready | 2026-10-17 | A question? |`,
    ]);
  });

  it("splices the table between its markers and leaves the rest", () => {
    const readme = `intro\n\n${START}\n\nold\n\n${END}\n\nafter\n`;
    const next = withIndex(readme, "NEW");
    expect(next).toBe(`intro\n\n${START}\n\nNEW\n\n${END}\n\nafter\n`);
  });

  it("returns null when the markers are missing", () => {
    expect(withIndex("no markers", "NEW")).toBeNull();
  });
});
