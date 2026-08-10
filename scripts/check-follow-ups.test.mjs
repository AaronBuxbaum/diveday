import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";

import { DIRECTORY, findEntryProblems } from "./check-follow-ups.mjs";

const FILENAME = "FU-20260808-example-entry.md";

const valid = `# FU-20260808-example-entry — Enforce the deposit window on the booking form

- **Status:** Open
- **Raised:** 2026-08-08 — PR #123 (deposit refactor)
- **Kind:** improvement
- **Effort:** M
- **Touches:** \`src/lib\`, \`docs/product/follow-ups\`

## What I noticed

The booking form accepts a deposit smaller than the cancellation window implies, so a diver can
hold a seat for less than the shop can recover if they cancel late.

## Why it isn't already done

Outside the scope I was given, and the floor is a pricing policy call rather than an engineering
one — a shop may want to accept the exposure to fill a boat.

## Proposed change

Validate the deposit against the cancellation window where the form is submitted, and surface the
refusal on the field rather than in a page banner.

## Prompt

\`\`\`text
In the diveday repo, make the booking form refuse a deposit that is smaller than the cancellation
window can recover. Read src/lib and the surrounding tests first, put the rule in the domain layer
rather than the route, and surface the refusal on the field with the Field error prop rather than a
page banner. Done when a failing regression test passes and pnpm check is green. Delete
${DIRECTORY}/${FILENAME} as part of the change.
\`\`\`
`;

const problemsFor = (contents, filename = FILENAME) =>
  findEntryProblems(filename, contents).problems;

describe("a well-formed entry", () => {
  it("passes", () => {
    expect(problemsFor(valid)).toEqual([]);
  });

  it("reports the paths the caller checks against disk", () => {
    expect(findEntryProblems(FILENAME, valid).touched).toEqual([
      "src/lib",
      "docs/product/follow-ups",
    ]);
  });

  it("accepts curly apostrophes in the section headings", () => {
    const curly = valid.replace("Why it isn't", "Why it isn’t");
    expect(problemsFor(curly)).toEqual([]);
  });
});

describe("naming", () => {
  it("refuses a filename that isn't an ADR-style dated id", () => {
    expect(problemsFor(valid, "deposit-window.md").join()).toMatch(/filename must be/);
  });

  it("catches a heading id that drifted from the filename", () => {
    const drifted = valid.replace("# FU-20260808-example-entry —", "# FU-20260808-other-entry —");
    expect(problemsFor(drifted).join()).toMatch(/does not match the filename/);
  });

  it("catches a Raised date that disagrees with the filename", () => {
    const mismatched = valid.replace("**Raised:** 2026-08-08", "**Raised:** 2026-07-01");
    expect(problemsFor(mismatched).join()).toMatch(/disagrees with the date in the filename/);
  });
});

describe("metadata", () => {
  it("refuses a status that closes the entry in place", () => {
    // Closing means deleting the file — same rule as the roadmap and assessments.
    const done = valid.replace("**Status:** Open", "**Status:** Done");
    expect(problemsFor(done).join()).toMatch(/Status/);
  });

  it("requires a Parked entry to say what would un-park it", () => {
    const parked = valid.replace("**Status:** Open", "**Status:** Parked");
    expect(problemsFor(parked).join()).toMatch(/what would un-park it/);
    const explained = parked.replace(
      "**Kind:**",
      "**Parked:** until the pricing model settles\n- **Kind:**",
    );
    expect(problemsFor(explained)).toEqual([]);
  });

  it("refuses an unknown kind or effort", () => {
    expect(problemsFor(valid.replace("**Kind:** improvement", "**Kind:** thought")).join()).toMatch(
      /Kind/,
    );
    expect(problemsFor(valid.replace("**Effort:** M", "**Effort:** XL")).join()).toMatch(/Effort/);
  });

  it("requires at least one touched path", () => {
    const untouched = valid.replace(/- \*\*Touches:\*\*.*\n/, "- **Touches:** the booking form\n");
    expect(problemsFor(untouched).join()).toMatch(/Touches/);
  });
});

describe("substance", () => {
  it("catches a missing section", () => {
    const truncated = valid.replace("## Proposed change", "## Something else");
    expect(problemsFor(truncated).join()).toMatch(/Proposed change/);
  });

  it("catches a section stubbed with a shrug", () => {
    const stubbed = valid.replace(
      /## Why it isn't already done\n[\s\S]*?\n## Proposed change/,
      "## Why it isn't already done\n\nOut of scope.\n\n## Proposed change",
    );
    expect(problemsFor(stubbed).join()).toMatch(/placeholder/);
  });

  it("catches unfilled template scaffolding", () => {
    const copied = valid.replace("PR #123 (deposit refactor)", "TBD");
    expect(problemsFor(copied).join()).toMatch(/unfilled template text/);
  });
});

describe("the prompt", () => {
  it("requires a fenced block", () => {
    const unfenced = valid.replace(/```text\n[\s\S]*?```/, "Fix the deposit window.");
    expect(problemsFor(unfenced).join()).toMatch(/fenced code block/);
  });

  it("refuses a prompt too short to brief a session with no context", () => {
    const terse = valid.replace(
      /```text\n[\s\S]*?```/,
      `\`\`\`text\nFix the deposit window in src/lib. Delete ${DIRECTORY}/${FILENAME}.\n\`\`\``,
    );
    expect(problemsFor(terse).join()).toMatch(/too short/);
  });

  it("refuses a prompt that names no files", () => {
    const vague = valid.replace(/src\/lib and the surrounding tests/, "the booking code");
    expect(problemsFor(vague.replace(`${DIRECTORY}/${FILENAME}`, "the entry")).join()).toMatch(
      /names no repo path/,
    );
  });

  it("requires the prompt to close out its own entry", () => {
    const orphan = valid.replace(`Delete\n${DIRECTORY}/${FILENAME} as part of the change.`, "");
    expect(problemsFor(orphan).join()).toMatch(/must tell the session to delete/);
  });
});

describe("the register on disk", () => {
  it("has no invalid entries", async () => {
    const directory = path.join(process.cwd(), DIRECTORY);
    const files = (await readdir(directory)).filter(
      (name) => name.startsWith("FU-") && name.endsWith(".md"),
    );
    for (const filename of files) {
      const contents = await readFile(path.join(directory, filename), "utf8");
      expect(findEntryProblems(filename, contents).problems).toEqual([]);
    }
  });
});
