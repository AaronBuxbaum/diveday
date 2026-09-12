/**
 * The filing door's whole reason to exist is that it *refuses*. A malformed
 * `needs-triage` issue fails `check:follow-ups` inside every open pull request's
 * `pnpm check`, so the property worth pinning is not that a good body files —
 * it is that a bad one never reaches `gh` at all (issue #1356, and the four
 * issues of 2026-09-04 it was written from). Every case here therefore runs the
 * script with a recording `gh` stub as the *only* thing on PATH: an inherited
 * PATH would let a real `gh` file a real issue from a unit test.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { findIssueProblems } from "./check-follow-ups.mjs";
import { parseFileArgs, renderFollowUpBody } from "./file-follow-up.mjs";

const root = path.join(import.meta.dirname, "..");

const fields = {
  kind: "improvement",
  effort: "M",
  touches: ["scripts/check-follow-ups.mjs", "docs/agents/issue-tracker.md"],
  noticed:
    "The filing helper composes the body from its arguments, so the four headings are never typed" +
    " by hand and cannot be spelled wrong by the session that files the issue.",
  why:
    "Outside the scope of the change that raised it, and the shape of the body is a documented" +
    " contract that deserves its own review rather than a drive-by edit.",
  proposed:
    "Compose the body here, run it back through findIssueProblems, and refuse to call gh when" +
    " anything comes back rather than filing an issue that reddens every open pull request.",
  prompt:
    "In the diveday repo, read scripts/file-follow-up.mjs and scripts/check-follow-ups.mjs, then" +
    " make the filing helper refuse any body the guard would reject. Done when a failing" +
    " regression test passes and the focused test file is green. Close this issue when the work" +
    " lands.",
};

const title = "Refuse a follow-up body the guard would reject";

describe("parseFileArgs", () => {
  const complete = [
    "--title",
    title,
    "--kind",
    "improvement",
    "--effort",
    "M",
    "--touches",
    "src/lib, docs/agents/issue-tracker.md",
    "--noticed",
    "noticed.md",
    "--why",
    "why.md",
    "--proposed",
    "proposed.md",
    "--prompt",
    "prompt.md",
  ];

  it("reads a complete invocation", () => {
    const parsed = parseFileArgs([...complete, "--label", "bug", "--dry-run"]);
    expect(parsed.error).toBeUndefined();
    expect(parsed.touches).toEqual(["src/lib", "docs/agents/issue-tracker.md"]);
    // `needs-triage` is the label this tracker runs on; it is never optional.
    expect(parsed.labels).toEqual(["needs-triage", "bug"]);
    expect(parsed.dryRun).toBe(true);
  });

  it("refuses an unrecognised flag", () => {
    expect(parseFileArgs([...complete, "--kindof", "risk"]).error).toMatch(/unrecognised argument/);
  });

  it("refuses a flag given twice", () => {
    expect(parseFileArgs([...complete, "--kind", "risk"]).error).toMatch(/--kind given twice/);
  });

  it("refuses a flag whose value is another flag", () => {
    // `--kind --effort M` must report a missing kind, never file an issue whose
    // **Kind:** is `--effort`.
    const parsed = parseFileArgs(["--title", title, "--kind", "--effort", "M"]);
    expect(parsed.error).toMatch(/--kind needs a value/);
  });

  it("names every required flag the caller left out", () => {
    expect(parseFileArgs(["--title", title]).error).toMatch(/--kind, --effort, --touches/);
  });

  /**
   * Only one direction of this is caught downstream. `--label
   * waiting-on-external` with no line is refused by `findIssueProblems`, which
   * demands one; a line with no label is silent, and files an issue that reads
   * as deferred to a human while counting as attention owed to `pnpm gates` and
   * to the persona walk's brake (#1497), both of which read the label.
   */
  it("refuses a Waiting on line without the label that gives it meaning", () => {
    const parsed = parseFileArgs([...complete, "--waiting-on", "the upstream release; see #12"]);
    expect(parsed.error).toMatch(/--waiting-on writes a line only the `waiting-on-external` label/);
  });

  it("refuses a Parked line without the label, and accepts it with one", () => {
    expect(parseFileArgs([...complete, "--parked", "until pricing settles"]).error).toMatch(
      /--parked writes a line only the `parked` label/,
    );
    const parsed = parseFileArgs([
      ...complete,
      "--parked",
      "until pricing settles",
      "--label",
      "parked",
    ]);
    expect(parsed.error).toBeUndefined();
    expect(parsed.labels).toEqual(["needs-triage", "parked"]);
  });

  it("refuses two flags both reading stdin", () => {
    const both = complete.map((item) => (item === "why.md" || item === "prompt.md" ? "-" : item));
    expect(parseFileArgs(both).error).toMatch(/only one flag can read stdin/);
  });
});

describe("renderFollowUpBody", () => {
  /**
   * The self-validation `scripts/persona-bots/findings.test.mjs` performs on the
   * bot's own bodies, for the same reason: a generator that emits a body this
   * repository's own guard rejects is a generator that reddens every branch.
   */
  it("composes a body the guard has nothing to say about", () => {
    const body = renderFollowUpBody(fields);
    expect(findIssueProblems({ number: 0, title, body }).problems).toEqual([]);
    expect(findIssueProblems({ number: 0, title, body }).touched).toEqual(fields.touches);
  });

  it("carries Waiting on and Parked when they are given", () => {
    const body = renderFollowUpBody({
      ...fields,
      waitingOn: "the upstream release that fixes the merge order; check that package's CHANGELOG",
      parked: "until the pricing model settles",
    });
    expect(
      findIssueProblems({ number: 0, title, body }, { waiting: true, parked: true }).problems,
    ).toEqual([]);
  });
});

describe("the refusal, at the process boundary", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "file-follow-up-"));
  const stubDir = mkdtempSync(path.join(tmpdir(), "file-follow-up-gh-"));
  const marker = path.join(stubDir, "gh-was-called");

  writeFileSync(
    path.join(stubDir, "gh"),
    `#!/bin/sh\necho called >> "${marker}"\necho https://github.com/AaronBuxbaum/diveday/issues/9999\n`,
    { mode: 0o755 },
  );

  const write = (name, text) => {
    const file = path.join(dir, name);
    writeFileSync(file, text);
    return file;
  };

  const argsFor = (overrides = {}) => {
    const merged = { ...fields, ...overrides };
    return [
      "--title",
      overrides.title ?? title,
      "--kind",
      merged.kind,
      "--effort",
      merged.effort,
      "--touches",
      merged.touches.join(", "),
      "--noticed",
      write("noticed.md", merged.noticed),
      "--why",
      write("why.md", merged.why),
      "--proposed",
      write("proposed.md", merged.proposed),
      "--prompt",
      write("prompt.md", merged.prompt),
    ];
  };

  const run = (...args) => {
    rmSync(marker, { force: true });
    const result = spawnSync(
      process.execPath,
      [path.join(import.meta.dirname, "file-follow-up.mjs"), ...args],
      // Only the stub dir on PATH: an inherited one would let a real `gh` file
      // a real issue from a test run.
      { cwd: root, env: { ...process.env, PATH: stubDir }, encoding: "utf8" },
    );
    return { ...result, spawnedGh: existsSync(marker) };
  };

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(stubDir, { recursive: true, force: true });
  });

  it("never spawns gh when the body would not pass", () => {
    // A prompt under the guard's floor — the single most common way a
    // hand-written follow-up fails.
    const result = run(...argsFor({ prompt: "Fix the filing helper. Close this issue." }));
    expect(result.status).toBe(1);
    expect(result.spawnedGh).toBe(false);
    expect(result.stderr).toMatch(/too short to brief a session/);
    expect(result.stderr).toMatch(/DID NOT FILE/);
    expect(result.stderr).toMatch(/every open pull request/);
  });

  it("refuses a Touches path that is not in this tree, rather than filing it", () => {
    // Fatal here where `--body`'s pre-flight only warns: this one is about to
    // put the entry in front of every other session's `pnpm check`.
    const result = run(...argsFor({ touches: ["src/lib/not-a-real-file-here.ts"] }));
    expect(result.status).toBe(1);
    expect(result.spawnedGh).toBe(false);
    expect(result.stderr).toMatch(/is not in this tree/);
  });

  it("refuses a Touches glob that matches nothing", () => {
    const result = run(...argsFor({ touches: ["src/i18n/locales/*/staff/no-such.json"] }));
    expect(result.status).toBe(1);
    expect(result.spawnedGh).toBe(false);
  });

  it("accepts a Touches glob that matches real files", () => {
    const result = run(...argsFor({ touches: ["src/i18n/locales/*/staff/trips.json"] }));
    expect(result.status).toBe(0);
    expect(result.spawnedGh).toBe(true);
  });

  it("files a good body and reports where it landed", () => {
    const result = run(...argsFor());
    expect(result.status).toBe(0);
    expect(result.spawnedGh).toBe(true);
    expect(result.stdout).toMatch(/issues\/9999/);
  });

  it("prints the body and files nothing under --dry-run", () => {
    const result = run(...argsFor(), "--dry-run");
    expect(result.status).toBe(0);
    expect(result.spawnedGh).toBe(false);
    expect(result.stdout).toMatch(/^\*\*Kind:\*\* improvement$/m);
    expect(result.stdout).toMatch(/^## Prompt$/m);
  });

  it("says which flag it could not read", () => {
    const args = argsFor();
    args[args.indexOf("--why") + 1] = path.join(dir, "absent.md");
    const result = run(...args);
    expect(result.status).toBe(1);
    expect(result.spawnedGh).toBe(false);
    expect(result.stderr).toMatch(/could not read --why/);
  });
});
