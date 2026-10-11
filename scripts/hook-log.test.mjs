import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  appendEntry,
  HOOK_LOG,
  lastSessionRefusals,
  parseLog,
  readLog,
  recordRefusal,
  refusalLine,
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
