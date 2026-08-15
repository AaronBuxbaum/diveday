import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";

import { DIRECTORY, findEntryProblems, WAITING_DIRECTORY } from "./check-follow-ups.mjs";

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

  it("reads the paths on a Touches line's wrapped continuation lines", () => {
    // Authors wrap these lines at 100 columns, so a long Touches list puts real
    // paths on line two and beyond. Stopping at the first newline reported them
    // to the caller as absent — which is how a follow-up shipped pointing at
    // `docs/adr/…`, a directory this repo has never had, without the existence
    // check ever seeing the string.
    const wrapped = valid.replace(
      "- **Touches:** `src/lib`, `docs/product/follow-ups`",
      "- **Touches:** `src/lib`,\n  `docs/product/follow-ups`,\n  `scripts/check-follow-ups.mjs`",
    );
    expect(findEntryProblems(FILENAME, wrapped).touched).toEqual([
      "src/lib",
      "docs/product/follow-ups",
      "scripts/check-follow-ups.mjs",
    ]);
    expect(problemsFor(wrapped)).toEqual([]);
  });

  it("stops a wrapped field at the next bullet", () => {
    // The continuation sweep must not swallow the sibling fields under it, or
    // `**Kind:**` would arrive carrying Effort and Touches and fail its set test.
    const wrapped = valid.replace(
      "- **Kind:** improvement",
      "- **Kind:** improvement\n  and a wrapped note about why",
    );
    expect(problemsFor(wrapped).join()).toMatch(/Kind/);
    expect(findEntryProblems(FILENAME, wrapped).touched).toEqual([
      "src/lib",
      "docs/product/follow-ups",
    ]);
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

describe("the waiting room", () => {
  // An entry in `waiting/` is blocked on somebody outside this repo. It is not a
  // triage state, so it swaps the status vocabulary rather than joining it — and
  // it owes the reader a way to check whether the block has lifted, without which
  // it is indistinguishable from an entry nobody got round to.
  const waiting = valid
    .replace("**Status:** Open", "**Status:** Waiting")
    .replace(`${DIRECTORY}/${FILENAME}`, `${WAITING_DIRECTORY}/${FILENAME}`);
  const waitingOn =
    "- **Waiting on:** an upstream release that fixes the merge order; check that package's" +
    ' CHANGELOG for "endpoint" whenever it is bumped\n';
  const complete = waiting.replace("- **Kind:**", `${waitingOn}- **Kind:**`);
  const waitingProblems = (contents) =>
    findEntryProblems(FILENAME, contents, { waiting: true }).problems;

  it("passes when it names the event and how to check it", () => {
    expect(waitingProblems(complete)).toEqual([]);
  });

  it("requires a Waiting on line", () => {
    expect(waitingProblems(waiting).join()).toMatch(/needs a \*\*Waiting on:\*\* line/);
  });

  it("refuses a Waiting on line too short to check cold", () => {
    const vague = waiting.replace("- **Kind:**", "- **Waiting on:** upstream\n- **Kind:**");
    expect(waitingProblems(vague).join()).toMatch(/too short to check cold/);
  });

  it("refuses an inbox status down here, and a Waiting status up there", () => {
    expect(waitingProblems(valid).join()).toMatch(/must say \*\*Status:\*\* Waiting/);
    expect(problemsFor(complete.replace(`${WAITING_DIRECTORY}/`, `${DIRECTORY}/`)).join()).toMatch(
      /Status/,
    );
  });

  it("expects the prompt to delete the file at its waiting-room path", () => {
    // The prompt carries a literal path, so moving a file between rooms without
    // fixing it points a cold reader at a file that is not there.
    const stale = complete.replace(`${WAITING_DIRECTORY}/${FILENAME}`, `${DIRECTORY}/${FILENAME}`);
    expect(waitingProblems(stale).join()).toMatch(/must tell the session to delete/);
  });
});

describe("the register on disk", () => {
  it.each([
    [DIRECTORY, false],
    [WAITING_DIRECTORY, true],
  ])("has no invalid entries in %s", async (directory, waiting) => {
    const files = (await readdir(path.join(process.cwd(), directory))).filter(
      (name) => name.startsWith("FU-") && name.endsWith(".md"),
    );
    for (const filename of files) {
      const contents = await readFile(path.join(process.cwd(), directory, filename), "utf8");
      expect(findEntryProblems(filename, contents, { waiting }).problems).toEqual([]);
    }
  });
});

describe("what counts as a touched path", () => {
  const touches = (line) =>
    valid.replace("- **Touches:** `src/lib`, `docs/product/follow-ups`", line);

  it("accepts a path that names a line, and checks the file", () => {
    // Pointing at `diver.json:2673` is *more* useful than pointing at a
    // 3,000-line bundle, so the line number is dropped for the existence check
    // rather than the entry being refused for carrying it.
    const entry = touches("- **Touches:** `src/lib/clock.ts:42`, `src/db:10:3`");
    expect(findEntryProblems(FILENAME, entry).touched).toEqual(["src/lib/clock.ts", "src/db"]);
    expect(problemsFor(entry)).toEqual([]);
  });

  it("ignores a backticked token that is not a path", () => {
    // An author naming the message key inside the bundle is giving the cold
    // reader exactly what they need. Treating it as a filename failed the whole
    // entry — the check teaching people to say less, which is backwards. Every
    // guarded root is a directory, so a real path always carries a slash.
    const entry = touches(
      "- **Touches:** `src/i18n/locales/en-US/diver.json` (`marketing.product.notCovered.gearSerials`)",
    );
    expect(findEntryProblems(FILENAME, entry).touched).toEqual([
      "src/i18n/locales/en-US/diver.json",
    ]);
    expect(problemsFor(entry)).toEqual([]);
  });

  it("still demands at least one real path", () => {
    // A Touches line of nothing but bare keys names nowhere to start.
    const entry = touches("- **Touches:** `importer.honesty.receiptsService`, `someOtherKey`");
    expect(problemsFor(entry).join()).toMatch(/Touches/);
  });
});
