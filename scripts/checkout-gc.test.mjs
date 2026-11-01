import { describe, expect, it } from "vitest";
import { hasWork, humanHours, inUseByProcess, keepReason } from "./checkout-gc.mjs";

const DAY = 24 * 3_600_000;
const idle = {
  isSelf: false,
  inUse: false,
  idleMs: 3 * DAY,
  windowMs: DAY,
  dirty: false,
  unpushed: false,
};

/**
 * A wrong "removable" deletes someone's work, so these pin each reason to keep a checkout, one at
 * a time, and the single shape that may go.
 */
describe("keepReason", () => {
  it("lets a clean, pushed, idle checkout go", () => {
    expect(keepReason(idle)).toBeNull();
  });

  it.each([
    [{ isSelf: true }, "this checkout"],
    [{ inUse: true }, "a process is working in it"],
    [{ idleMs: DAY / 2 }, "touched 12h ago"],
    [{ dirty: true }, "uncommitted changes"],
    [{ unpushed: true }, "commits on no remote branch"],
  ])("keeps one that fails %j", (override, reason) => {
    expect(keepReason({ ...idle, ...override })).toBe(reason);
  });
});

describe("hasWork", () => {
  it("ignores the provider copies in a fresh checkout", () => {
    expect(hasWork("?? .agents/\n?? .codex/\n")).toBe(false);
    expect(hasWork("")).toBe(false);
  });

  it("counts any other untracked or tracked change", () => {
    expect(hasWork("?? .agents/\n?? notes.md\n")).toBe(true);
    expect(hasWork(" M src/app/page.tsx\n")).toBe(true);
    expect(hasWork("?? .agents/skills/mine/\n")).toBe(true);
  });
});

describe("inUseByProcess", () => {
  const lsof = "p101\nn/Users/a/x/wt-one/src\np102\nn/Users/a/x/wt-two\n";

  it("matches a working directory inside the checkout or at its root", () => {
    expect(inUseByProcess(lsof, "/Users/a/x/wt-one")).toBe(true);
    expect(inUseByProcess(lsof, "/Users/a/x/wt-two")).toBe(true);
  });

  it("leaves a sibling that only shares a prefix alone", () => {
    expect(inUseByProcess(lsof, "/Users/a/x/wt")).toBe(false);
    expect(inUseByProcess(lsof, "/Users/a/x/wt-three")).toBe(false);
  });
});

describe("humanHours", () => {
  it("switches to days after two", () => {
    expect(humanHours(5 * 3_600_000)).toBe("5h");
    expect(humanHours(3 * DAY)).toBe("3d");
  });
});
