import { describe, expect, it } from "vitest";

import { findIssueProblems } from "./check-follow-ups.mjs";

const valid = {
  number: 123,
  title: "Enforce the deposit window on the booking form",
  body: `**Kind:** improvement
**Effort:** M
**Touches:** \`src/lib\`, \`docs/agents/issue-tracker.md\`

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
page banner. Done when a failing regression test passes and pnpm check is green. Close this issue
when the work lands.
\`\`\`
`,
};

const problemsFor = (body, overrides = {}) =>
  findIssueProblems({ ...valid, body, ...overrides }).problems;

describe("a well-formed issue", () => {
  it("passes", () => {
    expect(problemsFor(valid.body)).toEqual([]);
  });

  it("reports the paths the caller checks against disk", () => {
    expect(findIssueProblems(valid).touched).toEqual(["src/lib", "docs/agents/issue-tracker.md"]);
  });

  it("accepts curly apostrophes in the section headings", () => {
    const curly = valid.body.replace("Why it isn't", "Why it isn’t");
    expect(problemsFor(curly)).toEqual([]);
  });

  it("refuses a title that only names an area", () => {
    expect(problemsFor(valid.body, { title: "Deposits" }).join()).toMatch(
      /should say what should happen/,
    );
  });
});

describe("metadata", () => {
  it("refuses an unknown kind or effort", () => {
    expect(
      problemsFor(valid.body.replace("**Kind:** improvement", "**Kind:** thought")).join(),
    ).toMatch(/Kind/);
    expect(problemsFor(valid.body.replace("**Effort:** M", "**Effort:** XL")).join()).toMatch(
      /Effort/,
    );
  });

  it("requires at least one touched path", () => {
    const untouched = valid.body.replace(/\*\*Touches:\*\*.*\n/, "**Touches:** the booking form\n");
    expect(problemsFor(untouched).join()).toMatch(/Touches/);
  });

  it("reads the paths on a Touches line's wrapped continuation lines", () => {
    // Authors wrap these lines the way the old file-based entries did, so real
    // paths can land on line two and beyond.
    const wrapped = valid.body.replace(
      "**Touches:** `src/lib`, `docs/agents/issue-tracker.md`",
      "**Touches:** `src/lib`,\n  `docs/agents/issue-tracker.md`,\n  `scripts/check-follow-ups.mjs`",
    );
    expect(findIssueProblems({ ...valid, body: wrapped }).touched).toEqual([
      "src/lib",
      "docs/agents/issue-tracker.md",
      "scripts/check-follow-ups.mjs",
    ]);
    expect(problemsFor(wrapped)).toEqual([]);
  });

  it("stops a wrapped field at the next bullet", () => {
    const wrapped = valid.body.replace(
      "**Kind:** improvement",
      "**Kind:** improvement\n  and a wrapped note about why",
    );
    expect(problemsFor(wrapped).join()).toMatch(/Kind/);
    expect(findIssueProblems({ ...valid, body: wrapped }).touched).toEqual([
      "src/lib",
      "docs/agents/issue-tracker.md",
    ]);
  });
});

describe("substance", () => {
  it("catches a missing section", () => {
    const truncated = valid.body.replace("## Proposed change", "## Something else");
    expect(problemsFor(truncated).join()).toMatch(/Proposed change/);
  });

  it("catches a section stubbed with a shrug", () => {
    const stubbed = valid.body.replace(
      /## Why it isn't already done\n[\s\S]*?\n## Proposed change/,
      "## Why it isn't already done\n\nOut of scope.\n\n## Proposed change",
    );
    expect(problemsFor(stubbed).join()).toMatch(/placeholder/);
  });

  it("catches unfilled template scaffolding", () => {
    const copied = valid.body.replace("a pricing policy call", "TBD");
    expect(problemsFor(copied).join()).toMatch(/unfilled template text/);
  });
});

describe("the prompt", () => {
  it("requires a fenced block", () => {
    const unfenced = valid.body.replace(/```text\n[\s\S]*?```/, "Fix the deposit window.");
    expect(problemsFor(unfenced).join()).toMatch(/fenced code block/);
  });

  it("refuses a prompt too short to brief a session with no context", () => {
    const terse = valid.body.replace(
      /```text\n[\s\S]*?```/,
      "```text\nFix the deposit window in src/lib. Close this issue.\n```",
    );
    expect(problemsFor(terse).join()).toMatch(/too short/);
  });

  it("refuses a prompt that names no files", () => {
    const vague = valid.body.replace(/src\/lib and the surrounding tests/, "the booking code");
    expect(problemsFor(vague).join()).toMatch(/names no repo path/);
  });

  it("requires the prompt to say it closes the issue", () => {
    const orphan = valid.body.replace(/\s*Close this issue\s*when the work lands\./, "");
    expect(problemsFor(orphan).join()).toMatch(/must tell the session to close this issue/);
  });

  // Issue #632 was written correctly and failed anyway: its closing sentence wrapped between
  // "close" and "this issue", and the gap in the pattern refuses a newline. The check now tests
  // the prompt with its whitespace collapsed, so where a sentence happens to wrap is irrelevant.
  it("accepts a close instruction split across a line wrap", () => {
    const wrapped = valid.body.replace(
      /\s*Close this issue\s*when the work lands\./,
      "\nLanding them as three PRs is fine; close\nthis issue when the last one lands.",
    );
    expect(problemsFor(wrapped).join()).not.toMatch(/must tell the session to close this issue/);
  });

  it("accepts a past-tense close instruction too", () => {
    const past = valid.body.replace("Close this issue\nwhen the work lands.", "Closed this issue.");
    expect(problemsFor(past)).toEqual([]);
  });
});

describe("waiting-on-external", () => {
  const waitingOn =
    "**Waiting on:** an upstream release that fixes the merge order; check that package's" +
    ' CHANGELOG for "endpoint" whenever it is bumped\n';
  const withWaitingOn = (body) => body.replace("**Kind:**", `${waitingOn}**Kind:**`);
  const waitingProblems = (body) =>
    findIssueProblems({ ...valid, body }, { waiting: true }).problems;

  it("passes when it names the event and how to check it", () => {
    expect(waitingProblems(withWaitingOn(valid.body))).toEqual([]);
  });

  it("requires a Waiting on line", () => {
    expect(waitingProblems(valid.body).join()).toMatch(/needs a \*\*Waiting on:\*\* line/);
  });

  it("refuses a Waiting on line too short to check cold", () => {
    const vague = valid.body.replace("**Kind:**", "**Waiting on:** upstream\n**Kind:**");
    expect(waitingProblems(vague).join()).toMatch(/too short to check cold/);
  });

  it("does not demand Waiting on when the label is absent", () => {
    expect(problemsFor(valid.body)).toEqual([]);
  });
});

describe("parked", () => {
  const parkedProblems = (body) => findIssueProblems({ ...valid, body }, { parked: true }).problems;

  it("requires a Parked line", () => {
    expect(parkedProblems(valid.body).join()).toMatch(/needs a \*\*Parked:\*\* line/);
  });

  it("passes once it says what would un-park it", () => {
    const explained = valid.body.replace(
      "**Kind:**",
      "**Parked:** until the pricing model settles\n**Kind:**",
    );
    expect(parkedProblems(explained)).toEqual([]);
  });
});

describe("what counts as a touched path", () => {
  const touches = (line) =>
    valid.body.replace("**Touches:** `src/lib`, `docs/agents/issue-tracker.md`", line);

  it("accepts a path that names a line, and checks the file", () => {
    const entry = touches("**Touches:** `src/lib/clock.ts:42`, `src/db:10:3`");
    expect(findIssueProblems({ ...valid, body: entry }).touched).toEqual([
      "src/lib/clock.ts",
      "src/db",
    ]);
    expect(problemsFor(entry)).toEqual([]);
  });

  it("ignores a backticked token that is not a path", () => {
    const entry = touches(
      "**Touches:** `src/i18n/locales/en-US/diver.json` (`marketing.product.notCovered.gearSerials`)",
    );
    expect(findIssueProblems({ ...valid, body: entry }).touched).toEqual([
      "src/i18n/locales/en-US/diver.json",
    ]);
    expect(problemsFor(entry)).toEqual([]);
  });

  it("still demands at least one real path", () => {
    const entry = touches("**Touches:** `importer.honesty.receiptsService`, `someOtherKey`");
    expect(problemsFor(entry).join()).toMatch(/Touches/);
  });
});
