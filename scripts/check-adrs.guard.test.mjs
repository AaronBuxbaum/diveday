import { describe, expect, it } from "vitest";

import { runGuard } from "./guard-fixture.mjs";

const DIR = "docs/architecture/decisions";

const adr = (heading, { status = "Accepted", date = "2026-10-10", sections } = {}) =>
  [
    `# ${heading}`,
    "",
    `- **Status:** ${status}`,
    `- **Date:** ${date}`,
    "",
    ...(sections ?? ["Context", "Decision", "Alternatives considered", "Consequences"]).flatMap(
      (section) => [`## ${section}`, "", "Text.", ""],
    ),
  ].join("\n");

const run = (records) =>
  runGuard(
    "check-adrs.mjs",
    Object.fromEntries(Object.entries(records).map(([name, body]) => [`${DIR}/${name}`, body])),
  );

describe("check-adrs", () => {
  it("passes a well-formed record of each id shape, and ignores the README and template", () => {
    const result = run({
      "20261010-one-thing.md": adr("20261010-one-thing — One thing"),
      "0042-old-thing.md": adr("0042 — Old thing"),
      "README.md": "# Index\n",
      "0000-template.md": "# NNNN — Title\n",
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("adrs: 2 records valid");
  });

  it("refuses an id that is neither NNNN-slug nor YYYYMMDD-slug", () => {
    const result = run({ "Thing.md": adr("Thing — Thing") });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Thing.md: id must be NNNN-slug (historical) or YYYYMMDD-slug (new)",
    );
  });

  it("refuses a heading whose id does not match the filename", () => {
    const result = run({ "20261010-one-thing.md": adr("20261010-other — One thing") });
    expect(result.stderr).toContain("heading id must be 20261010-one-thing");
  });

  it("holds a historical record's heading to its four digits", () => {
    const result = run({ "0042-old-thing.md": adr("0042-old-thing — Old thing") });
    expect(result.stderr).toContain("0042-old-thing.md: heading id must be 0042");
  });

  it("accepts a status that begins with a known word, and refuses one that does not", () => {
    expect(
      run({
        "20261010-a.md": adr("20261010-a — A", { status: "Superseded by 20261011-b" }),
      }).status,
    ).toBe(0);
    expect(run({ "20261010-a.md": adr("20261010-a — A", { status: "Draft" }) }).stderr).toContain(
      "status must begin with Proposed, Accepted, Deprecated, Superseded",
    );
  });

  it("refuses a date that is not ISO", () => {
    expect(
      run({ "20261010-a.md": adr("20261010-a — A", { date: "10 October 2026" }) }).stderr,
    ).toContain("20261010-a.md: missing ISO Date metadata");
  });

  it("names each missing section", () => {
    const { stderr } = run({
      "20261010-a.md": adr("20261010-a — A", { sections: ["Context", "Decision"] }),
    });
    expect(stderr).toContain("missing section “Alternatives considered”");
    expect(stderr).toContain("missing section “Consequences”");
  });

  it("refuses two historical records that share their four digits", () => {
    const { status, stderr } = run({
      "0042-one.md": adr("0042 — One"),
      "0042-two.md": adr("0042 — Two"),
    });
    expect(status).toBe(1);
    expect(stderr).toMatch(/duplicate ADR id 0042: 0042-(one|two)\.md, 0042-(one|two)\.md/);
  });
});
