import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  appendEntry,
  HOOK_LOG,
  lastSessionRefusals,
  PAPERCUT_THRESHOLD,
  papercutLine,
  parseLog,
  readLog,
  recordRefusal,
  refusalLine,
  repeatedRefusal,
  ruleOf,
} from "./hook-log.mjs";

const refusal = (session, hook) => ({ session, hook, kind: "refusal", reason: "r" });

describe("the hook refusal log", () => {
  it("appends one JSON line per refusal and reads them back", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "hook-log-"));
    mkdirSync(path.join(root, ".claude"));
    recordRefusal("guard-bash", "first line\nsecond line", { session: "s1", root });
    recordRefusal("guard-read", "x".repeat(400), { session: "s1", root });
    const entries = readLog({ root });
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ session: "s1", hook: "guard-bash", reason: "first line" });
    expect(entries[1].reason).toHaveLength(160);
    expect(
      readFileSync(path.join(root, HOOK_LOG), "utf8").split("\n").filter(Boolean),
    ).toHaveLength(2);
  });

  it("never throws when the log cannot be written", () => {
    expect(() => appendEntry({ kind: "refusal" }, { root: "/nonexistent/dir" })).not.toThrow();
    expect(readLog({ root: "/nonexistent/dir" })).toEqual([]);
  });

  it("skips a torn line rather than failing", () => {
    expect(parseLog('{"kind":"refusal"}\n{"kind":\n\n')).toEqual([{ kind: "refusal" }]);
  });
});

describe("the previous session's tally", () => {
  it("counts the newest other session's refusals, by hook", () => {
    const entries = [
      refusal("old", "guard-bash"),
      refusal("prev", "guard-bash"),
      refusal("prev", "guard-read"),
      refusal("prev", "guard-bash"),
      refusal("now", "guard-read"),
    ];
    expect(lastSessionRefusals(entries, "now")).toEqual({
      session: "prev",
      count: 3,
      byHook: { "guard-bash": 2, "guard-read": 1 },
    });
  });

  it("says it once per session, and nothing when nothing was refused", () => {
    const entries = [refusal("prev", "guard-bash"), { session: "now", kind: "noted" }];
    expect(lastSessionRefusals(entries, "now")).toBeNull();
    expect(lastSessionRefusals([], "now")).toBeNull();
    expect(lastSessionRefusals([refusal("now", "guard-bash")], "now")).toBeNull();
  });

  it("words the line with the count, the hooks, and the papercut log", () => {
    expect(refusalLine({ count: 1, byHook: { "guard-read": 1 } })).toBe(
      "1 hook refusal last session (guard-read 1): if one fought you, add a papercut (docs/agents/papercuts.md)",
    );
    expect(refusalLine(null)).toBe("");
  });
});

describe("asking for a papercut", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  const at = (days) => new Date(now.getTime() - days * 86_400_000).toISOString();
  const tail = (cmd, days, session = "s1") => ({
    at: at(days),
    session,
    hook: "guard-bash",
    kind: "refusal",
    reason: `\`${cmd} | tail -8\` — never pipe a long-running command through \`tail\` or \`head\`.`,
  });

  it("reads one rule out of reasons that quote different commands", () => {
    expect(ruleOf(tail("pnpm test a.test.ts", 0).reason)).toBe(
      ruleOf(tail("pnpm e2e b.spec.ts --reporter=line", 0).reason),
    );
    expect(ruleOf("`a very long command cut off at one hundred and sixty char")).toBe("");
  });

  it("names the rule refused three times this week, across sessions, with a slug", () => {
    const entries = [
      tail("pnpm test a", 0.1, "s1"),
      tail("pnpm test b", 2, "s2"),
      tail("pnpm e2e c", 6, "s3"),
      { at: at(0), session: "s1", hook: "guard-read", kind: "refusal", reason: "too long" },
    ];
    const repeat = repeatedRefusal(entries, { now });
    expect(repeat).toMatchObject({ hook: "guard-bash", count: PAPERCUT_THRESHOLD });
    expect(repeat.slug).toMatch(/^guard-bash-never-pipe-a-long/);
    expect(papercutLine(repeat)).toContain(
      `write a papercut: node scripts/file-follow-up.mjs --papercut ${repeat.slug}`,
    );
  });

  it("says nothing under three, or for refusals older than a week", () => {
    expect(repeatedRefusal([tail("a", 0), tail("b", 1)], { now })).toBeNull();
    expect(repeatedRefusal([tail("a", 0), tail("b", 1), tail("c", 8)], { now })).toBeNull();
    expect(papercutLine(null)).toBe("");
  });
});
