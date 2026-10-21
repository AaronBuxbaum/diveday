import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sourceReaders, testPlan } from "./test-affected.mjs";

const reader = "src/features/contracts.test.ts";
const options = { readers: [reader], existing: () => true, isSharedTest: () => false };

describe("local unit selection", () => {
  it("runs changed tests directly without related discovery", () => {
    const plan = testPlan({ ...options, changed: ["src/lib/a.test.ts"] });
    expect(plan.mode).toBe("direct");
    expect(plan.files).toEqual(["src/lib/a.test.ts"]);
  });
  it("retains native alias/import selection and includes mixed source readers", () => {
    const plan = testPlan({ ...options, changed: ["src/lib/a.ts"], extra: ["src/db/red.test.ts"] });
    expect(plan.mode).toBe("related");
    expect(plan.files).toEqual(["src/db/red.test.ts", reader, "src/lib/a.ts"]);
  });
  it("includes source readers when documents alone change", () => {
    expect(testPlan({ ...options, changed: ["docs/a.md"] }).files).toEqual([reader]);
  });
  it.each([
    "package.json",
    "pnpm-lock.yaml",
    "vitest.config.ts",
    "tsconfig.json",
    "drizzle/one.sql",
    "src/test/setup.ts",
    "src/db/schema/divers.ts",
  ])("runs all units for global input %s", (file) => {
    expect(testPlan({ ...options, changed: [file] }).mode).toBe("all");
  });
  it("falls back for deleted production dependencies and unknown inputs", () => {
    expect(testPlan({ ...options, changed: ["src/lib/gone.ts"], existing: () => false }).mode).toBe(
      "all",
    );
    expect(testPlan({ ...options, changed: ["some-new-config.yaml"] }).mode).toBe("all");
  });
  it("never passes a deleted test to Vitest", () => {
    expect(
      testPlan({ ...options, changed: ["src/lib/gone.test.ts"], existing: () => false }).files,
    ).toEqual([]);
  });
  it("keeps native discovery for a changed test exporting a shared fixture", () => {
    expect(
      testPlan({ ...options, changed: ["src/lib/shared.test.ts"], isSharedTest: () => true }).mode,
    ).toBe("related");
  });
  it("fails broad when disk-reader discovery fails", () => {
    expect(
      testPlan({
        changed: ["src/lib/a.ts"],
        readers: null,
        existing: () => true,
        isSharedTest: () => false,
      }).mode,
    ).toBe("all");
  });
});

describe("disk-reading helper seeds", () => {
  it("includes indirect readers and leaves database fixture I/O to schema/global fallbacks", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "source-readers-"));
    mkdirSync(path.join(root, "src/test"), { recursive: true });
    writeFileSync(
      path.join(root, "src/test/contract.ts"),
      'import { readFileSync } from "node:fs";',
    );
    writeFileSync(
      path.join(root, "src/test/db-template.ts"),
      'import { readFileSync } from "node:fs";',
    );
    writeFileSync(path.join(root, "src/test/prose.ts"), "// stylesheet glob sourceFiles readFile");
    writeFileSync(
      path.join(root, "src/test/writer.ts"),
      'import { writeFileSync } from "node:fs";',
    );
    expect(sourceReaders(root)).toEqual(["src/test/contract.ts"]);
  });
  it("falls broad on reader discovery failure in a document plus test diff", () => {
    expect(
      testPlan({ ...options, changed: ["src/lib/a.test.ts", "docs/a.md"], readers: null }).mode,
    ).toBe("all");
  });
});

it("keeps helper importers when documents and a test change together", () => {
  const result = testPlan({
    ...options,
    changed: ["src/lib/a.test.ts", "docs/a.md"],
    readers: ["src/test/source-helper.ts"],
  });
  expect(result.mode).toBe("related");
  expect(result.files).toContain("src/test/source-helper.ts");
});
