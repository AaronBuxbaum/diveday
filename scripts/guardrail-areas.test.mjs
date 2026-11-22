import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { areasOf, isLogicFile, isTestFile, ruleFileKind } from "./guardrail-areas.mjs";
import { classifyScope } from "./mutation/scope.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Every file under `dir`, as a posix path from the repository root. */
function walk(dir) {
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${dir}/${entry.name}`;
    return entry.isDirectory() ? walk(relative) : [relative];
  });
}

describe("areas", () => {
  it("names the area of every file the breakage drills break on purpose", () => {
    const wrong = walk("src")
      .map((file) => [file, classifyScope(file)])
      .filter(([file, scope]) => scope && !areasOf(file).includes(scope));
    expect(wrong).toEqual([]);
  });

  it("calls a promo code, a deposit and an authorization file what they are", () => {
    expect(areasOf("src/lib/promo-codes.ts")).toContain("money");
    expect(areasOf("src/lib/deposits.ts")).toContain("money");
    expect(areasOf("src/lib/authz.ts")).toContain("safety");
  });

  it("leaves a screen, a test and a doc out of money and safety", () => {
    expect(areasOf("docs/engineering/testing.md")).toEqual([]);
    expect(isTestFile("src/lib/promo-codes.test.ts")).toBe(true);
    expect(isLogicFile("src/lib/promo-codes.test.ts")).toBe(false);
    expect(ruleFileKind("src/lib/promo-codes.ts")).toBeNull();
  });
});
