/**
 * The filing door's whole reason to exist is that it *refuses*. A malformed
 * `needs-triage` issue fails `check:follow-ups` for everyone until a human edits
 * it, so the property worth pinning is not that a good body files —
 * it is that a bad one never reaches `gh` at all (issue #1356, and the four
 * issues of 2026-09-04 it was written from). Every case here therefore runs the
 * script with a recording `gh` stub as the *only* thing on PATH: an inherited
 * PATH would let a real `gh` file a real issue from a unit test.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { findIssueProblems } from "./check-follow-ups.mjs";
import {
  FOLLOW_UP_QUOTA,
  filedInWindow,
  ledgerPath,
  parseFileArgs,
  parsePapercutArgs,
  QUOTA_LEDGER_ENV,
  renderFollowUpBody,
  renderPapercut,
} from "./file-follow-up.mjs";

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

  it("routes a question to the human queue instead of the agent inbox", () => {
    const asked = complete.map((item) => (item === "improvement" ? "question" : item));
    const parsed = parseFileArgs([...asked, "--label", "parked", "--parked", "until spring"]);
    expect(parsed.error).toBeUndefined();
    expect(parsed.labels).toEqual(["ready-for-human", "parked"]);
  });

  it("files an idea under its own label, out of the inbox and the human queue", () => {
    const parsed = parseFileArgs([...complete, "--idea", "--label", "enhancement"]);
    expect(parsed.error).toBeUndefined();
    expect(parsed.idea).toBe(true);
    expect(parsed.labels).toEqual(["idea", "enhancement"]);
  });

  it("leaves a plain filing out of the idea shelf", () => {
    expect(parseFileArgs(complete).idea).toBe(false);
  });

  it("refuses an idea that is really a question", () => {
    const asked = complete.map((item) => (item === "improvement" ? "question" : item));
    expect(parseFileArgs([...asked, "--idea"]).error).toMatch(/drop --idea/);
  });

  it("refuses --idea given twice", () => {
    expect(parseFileArgs([...complete, "--idea", "--idea"]).error).toMatch(/--idea given twice/);
  });

  it("refuses two flags both reading stdin", () => {
    const both = complete.map((item) => (item === "why.md" || item === "prompt.md" ? "-" : item));
    expect(parseFileArgs(both).error).toMatch(/only one flag can read stdin/);
  });
});

describe("the filing quota", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const hoursAgo = (h) => new Date(now.getTime() - h * 3_600_000).toISOString();

  it("counts only this window's filings, so a new run starts with its quota", () => {
    const stamps = [hoursAgo(1), hoursAgo(11.5), hoursAgo(13), "not a date"];
    expect(filedInWindow(stamps, now)).toBe(2);
    expect(FOLLOW_UP_QUOTA).toBe(10);
  });

  it("reads ledger lines that carry the filing branch after a tab", () => {
    const lines = [`${hoursAgo(1)}\tclaude/x-3`, `${hoursAgo(2)}\t`, `${hoursAgo(20)}\tclaude/x-1`];
    expect(filedInWindow(lines, now)).toBe(2);
  });

  it("keeps one ledger per clone, so every worktree of a stack shares one quota", () => {
    const env = {};
    const worktree = ledgerPath("/clone/wt-3", { env, git: () => "/clone/main/.git" });
    const main = ledgerPath("/clone/main", { env, git: () => ".git" });
    expect(worktree).toBe("/clone/main/.git/diveday-follow-up-log");
    expect(main).toBe(worktree);
    expect(ledgerPath("/plain", { env, git: () => null })).toBe("/plain/.claude/.follow-up-log");
    expect(
      ledgerPath("/clone/wt-3", { env: { [QUOTA_LEDGER_ENV]: "/tmp/l" }, git: () => "x" }),
    ).toBe("/tmp/l");
  });

  it("accepts --over-quota as a value flag", () => {
    expect(parseFileArgs(["--over-quota"]).error).toMatch(/needs a value/);
  });
});

describe("--papercut", () => {
  const args = [
    "--papercut",
    "tail-refused",
    "--project",
    "tooling",
    "--symptom",
    "a",
    "--fix",
    "b",
  ];

  it("reads the four fields and a slug", () => {
    expect(parsePapercutArgs(args)).toEqual({
      slug: "tail-refused",
      project: "tooling",
      symptom: "a",
      fix: "b",
      dryRun: false,
    });
  });

  it("refuses a missing field, a stray flag, and a slug that is not one", () => {
    expect(parsePapercutArgs(args.slice(0, 6)).error).toMatch(/missing --fix/);
    expect(parsePapercutArgs([...args, "--title", "x"]).error).toMatch(/unrecognised/);
    expect(parsePapercutArgs(["--papercut", "Bad Slug", ...args.slice(2)]).error).toMatch(
      /not a slug/,
    );
  });

  it("writes the four lines the papercuts doc asks for, one line each", () => {
    expect(
      renderPapercut({ date: "2026-10-13", project: "e2e", symptom: "one\ntwo", fix: "three" }),
    ).toBe("Date: 2026-10-13\nProject: e2e\nSymptom: one two\nFix: three\n");
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
  const openIssues = path.join(stubDir, "open-issues.json");
  const ledger = path.join(stubDir, "ledger");
  const setOpen = (issues) => writeFileSync(openIssues, JSON.stringify(issues));
  setOpen([]);

  writeFileSync(
    path.join(stubDir, "gh"),
    // Answers as `gh api --method POST repos/…/issues` does, and records its argv so the
    // test can see the request went to REST rather than `gh issue create` (GraphQL).
    // A read (no --method) answers with the open issues in `openIssues` (one line of JSON, read
    // with shell builtins: nothing else is on PATH), so the duplicate and inbox checks have
    // something to read.
    `#!/bin/sh\necho "$*" >> "${marker}"\ncase "$*" in\n  *--method*) echo '{"number":9999,"html_url":"https://github.com/AaronBuxbaum/diveday/issues/9999"}' ;;\n  *) IFS= read -r line < "${openIssues}"; echo "$line" ;;\nesac\n`,
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

  /** Repoint one file flag's value. The parser refuses a repeated flag, so a
   *  second `--noticed` on the end would be rejected before the path is read. */
  const pointFlagAt = (args, flag, value) => {
    const at = args.indexOf(flag);
    if (at < 0) throw new Error(`no ${flag} in these args`);
    return args.map((arg, index) => (index === at + 1 ? value : arg));
  };

  const run = (...args) => {
    rmSync(marker, { force: true });
    const result = spawnSync(
      process.execPath,
      [path.join(import.meta.dirname, "file-follow-up.mjs"), ...args],
      // Only the stub dir on PATH: an inherited one would let a real `gh` file
      // a real issue from a test run.
      // The ledger goes to the stub dir: a test filing must not spend the clone's quota.
      {
        cwd: root,
        env: { ...process.env, PATH: stubDir, [QUOTA_LEDGER_ENV]: ledger },
        encoding: "utf8",
      },
    );
    return { ...result, spawnedGh: existsSync(marker), filed: wasFiled() };
  };

  const wasFiled = () => existsSync(marker) && /--method POST/.test(readFileSync(marker, "utf8"));

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

  it("refuses to read prose from outside the checkout and the scratch directory", () => {
    // The finding this guard exists for: `--noticed .env.local` would put the
    // shop's Stripe key and AUTH_SECRET into the "What I noticed" section of a
    // public issue, and the word-count check would wave it through, because an
    // env file clears the floor comfortably (`security-reviewer`, issue 1356).
    // A home directory is the realistic shape — a credential store nobody
    // meant to publish.
    const outside = path.join(homedir(), ".aws", "credentials");
    const result = run(...pointFlagAt(argsFor(), "--noticed", outside));
    expect(result.status).toBe(1);
    expect(result.spawnedGh).toBe(false);
    expect(result.stderr).toMatch(/resolves outside the checkout/);
  });

  it("refuses a symlink that points out of the allowed directories", () => {
    // The first version of the containment check was lexical, so a link named
    // innocuously inside the checkout passed it and `readFile` followed it
    // straight to the target — the exact primitive the check exists to close
    // (`sourcery-ai` on PR 1743). Reproduced before fixing: the link below
    // resolved clean and its contents would have gone into a public issue.
    // `/etc/hostname` stands in for the real target — a credential store in a
    // home directory — because it is readable, outside both allowed roots, and
    // not ours to create. The link sits inside the scratch directory, so only
    // resolving it reveals where it goes.
    const target = "/etc/hostname";
    if (!existsSync(target)) return;
    const link = path.join(dir, "looks-innocent.md");
    try {
      symlinkSync(target, link);
    } catch {
      return; // a filesystem without symlinks has nothing to prove here
    }

    const result = run(...pointFlagAt(argsFor(), "--noticed", link));

    expect(result.status).toBe(1);
    expect(result.spawnedGh).toBe(false);
    expect(result.stderr).toMatch(/resolves outside the checkout/);
  });

  it("refuses an env file even where it is allowed to read", () => {
    // Inside the checkout, so the containment check passes it — the name is
    // what refuses it. Both doors, because either alone leaves a way through.
    const result = run(...pointFlagAt(argsFor(), "--why", path.join(root, ".env.local")));
    expect(result.status).toBe(1);
    expect(result.spawnedGh).toBe(false);
    expect(result.stderr).toMatch(/is an env file/);
  });

  it("refuses a body that carries something credential-shaped", () => {
    // The seatbelt under the two checks above, for a secret that arrives
    // through an ordinary file in an allowed place — a scratch note, a pasted
    // log, a captured request. Refused at the body, after composing and before
    // `gh`.
    const result = run(
      ...argsFor({
        why: `${fields.why}\n\nThe connection string in the log was postgresql://diveday:hunter2@db.example.com:5432/diveday which is how I found it.`,
      }),
    );
    expect(result.status).toBe(1);
    expect(result.spawnedGh).toBe(false);
    expect(result.stderr).toMatch(/looks like it carries a credential/);
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
    expect(readFileSync(marker, "utf8")).toMatch(
      /^api --method POST repos\/AaronBuxbaum\/diveday\/issues --input -$/m,
    );
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

  it("files a title that reads like an open issue, and names the twin to fold into", () => {
    setOpen([{ number: 2412, title: "Refuse a follow-up body the guard would reject sometimes" }]);
    const result = run(...argsFor());
    setOpen([]);
    expect(result.status).toBe(0);
    expect(result.filed).toBe(true);
    expect(result.stderr).toMatch(/#2412 .* reads like this one/);
  });

  it("refuses a needs-triage filing while the inbox is over its ceiling, unless over quota", () => {
    const full = Array.from({ length: 41 }, (_, n) => ({
      number: n + 1,
      title: `Unrelated follow-up number ${n}`,
      labels: [{ name: "needs-triage" }],
    }));
    setOpen(full);
    const refused = run(...argsFor());
    const allowed = run(...argsFor(), "--over-quota", "the stack cannot land without it");
    setOpen([]);
    expect(refused.status).toBe(1);
    expect(refused.filed).toBe(false);
    expect(refused.stderr).toMatch(/41 issues are open under label:needs-triage/);
    expect(allowed.status).toBe(0);
    expect(allowed.filed).toBe(true);
  });

  it("records each filing in the clone's ledger, not the checkout", () => {
    rmSync(ledger, { force: true });
    expect(run(...argsFor()).status).toBe(0);
    expect(readFileSync(ledger, "utf8")).toMatch(/^\d{4}-\d\d-\d\dT[^\t]+\t.*\n$/);
  });

  it("writes nothing under --papercut --dry-run, and names the file it would write", () => {
    const result = run(
      "--papercut",
      "tail-refused",
      "--project",
      "tooling",
      "--symptom",
      "guard-bash refused a piped tail",
      "--fix",
      "redirect to a file",
      "--dry-run",
    );
    expect(result.status).toBe(0);
    expect(result.spawnedGh).toBe(false);
    expect(result.stdout).toMatch(/^docs\/agents\/papercuts\/\d{4}-\d\d-\d\d-tail-refused\.md$/m);
    expect(result.stdout).toMatch(/^Fix: redirect to a file$/m);
  });
});
