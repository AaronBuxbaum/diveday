import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { affectedSpecs } from "./e2e-affected.mjs";

it("uses working locale bytes and staged/unstaged diff, includes untracked source paths", () => {
  const root = mkdtempSync(path.join(tmpdir(), "affected-worktree-"));
  const locale = "src/i18n/locales/en-US/staff/booking.json";
  const calls = [];
  const git = (args) => {
    calls.push(args);
    if (args[0] === "merge-base") return "base-sha";
    if (args[0] === "ls-files") return "src/new-module.ts";
    if (args.includes("--name-only")) return locale;
    if (args[0] === "diff") return "";
    if (args[0] === "show") return '{"title":"old"}';
    return null;
  };
  try {
    mkdirSync(path.join(root, "src/i18n/locales/en-US/staff"), { recursive: true });
    mkdirSync(path.join(root, "e2e"));
    mkdirSync(path.join(root, "src/db"));
    writeFileSync(path.join(root, locale), '{"title":"new"}');
    writeFileSync(path.join(root, "src/new-module.ts"), "export const value = 1;");
    writeFileSync(path.join(root, "e2e/booking.spec.ts"), 'expect(t("booking.title"));');
    const result = affectedSpecs({ root, base: "base", workingTree: true, git });
    expect(result.changed).toContain("src/new-module.ts");
    expect(result.fallbacks).toContain(
      "runtime input has no mapped browser coverage: src/new-module.ts",
    );
    expect([...result.strong.get("e2e/booking.spec.ts")]).toContain("reads booking.title");
    expect(calls.find((args) => args.includes("-U0"))).not.toContain("HEAD");
    expect(calls.some((args) => args[0] === "show" && args[1].startsWith("HEAD:"))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it("refuses mixing historical commits and live inputs", () => {
  expect(() => affectedSpecs({ commit: "abc", workingTree: true })).toThrow(/cannot be combined/);
});
it("does not turn a git patch failure into an empty change", () => {
  const git = (args) =>
    args[0] === "merge-base" ? "base" : args.includes("--name-only") ? "src/a.ts" : null;
  expect(affectedSpecs({ base: "base", git })).toBeNull();
});
