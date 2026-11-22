import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { describe as describeReport, firstFailingFile, runDrills } from "./run.mjs";

// The acceptance check for the whole design (ADR 20261122-diff-mutation-testing): real Vitest
// processes through vitest.mutation.config.ts and the real runner, no mocks. The two fixtures
// hold the same in-function boundary; only the first one's test pins it.
const ROOT = path.join(import.meta.dirname, "..", "..");
const PINNED = "scripts/mutation/fixtures/pinned/adult.ts";
const LOOSE = "scripts/mutation/fixtures/loose/adult.ts";
const POLICY = { money: "block", safety: "block" };
const SCRATCH = `scripts/mutation/fixtures/tmp-${process.pid}`;

afterAll(() => rmSync(path.join(ROOT, SCRATCH), { recursive: true, force: true }));

function scratch(name, files) {
  const dir = path.join(ROOT, SCRATCH, name);
  mkdirSync(dir, { recursive: true });
  for (const [file, text] of Object.entries(files)) writeFileSync(path.join(dir, file), text);
  return `${SCRATCH}/${name}`;
}

const BOUNDARY = "export function adult(age: number) {\n  return age >= 18;\n}\n";
const flip = (outcomes, file) =>
  outcomes.find((m) => m.file === file && m.was === ">=" && m.became === ">");

describe("runDrills", { timeout: 180_000 }, () => {
  it("kills the pinned boundary and lets the loose one survive, four mutants at a time", async () => {
    const { report, outcomes } = await runDrills({
      root: ROOT,
      mode: "file",
      files: [PINNED, LOOSE],
      head: "kill-test",
      parallel: 4,
      policy: POLICY,
    });
    expect(report.notRun).toBeNull();
    expect(flip(outcomes, PINNED).outcome).toBe("killed");
    expect(flip(outcomes, LOOSE).outcome).toBe("survived");
    // Six mutants ran side by side; each saw its own text and no other run's.
    expect(outcomes.filter((m) => m.file === PINNED).map((m) => m.outcome)).toEqual([
      "killed",
      "killed",
      "killed",
    ]);
    const loose = Object.fromEntries(
      outcomes.filter((m) => m.file === LOOSE).map((m) => [m.operator, m.outcome]),
    );
    expect(loose).toEqual({
      "return nothing": "killed",
      "flip a comparison": "survived",
      "change a number": "survived",
    });
    const looseEntry = report.files.find((file) => file.path === LOOSE);
    expect(looseEntry).toMatchObject({
      killed: 1,
      score: 33.33,
      testFiles: [`${LOOSE.replace(".ts", ".test.ts")}`],
    });
    expect(looseEntry.survivors[0]).toMatchObject({ line: 3, snippet: "return age >= 18;" });
    expect(report).toMatchObject({ schema: 1, mode: "file", eligible: 6, tried: 6, capped: false });
    expect(report.totals).toEqual({
      killed: 4,
      survived: 2,
      uncompilable: 0,
      accepted: 0,
      notTried: 0,
    });
  });

  it("stops on a red baseline without claiming any mutant", async () => {
    const dir = scratch("red", {
      "adult.ts": BOUNDARY,
      "adult.test.ts":
        'import { expect, it } from "vitest";\nimport { adult } from "./adult";\nit("is red before any break", () => expect(adult(1)).toBe(true));\n',
    });
    const { report, outcomes } = await runDrills({
      root: ROOT,
      mode: "file",
      files: [`${dir}/adult.ts`],
      head: "red",
      policy: POLICY,
    });
    expect(report.notRun).toBe(`baseline red: ${dir}/adult.test.ts`);
    expect(outcomes).toEqual([]);
    expect(report.files).toEqual([]);
    expect(describeReport(report).blocking).toBe(true);
  });

  it("counts every mutant of a file no test imports as a survivor, and says why", async () => {
    const dir = scratch("untested", { "alone.ts": BOUNDARY });
    const { report } = await runDrills({
      root: ROOT,
      mode: "file",
      files: [`${dir}/alone.ts`],
      head: "alone",
      policy: POLICY,
    });
    expect(report.totals.survived).toBe(3);
    expect(report.files[0].survivors.map((s) => s.reason)).toEqual(
      Array(3).fill("no test imports this file"),
    );
  });

  it("stops starting mutants when the time box runs out and counts the rest as not tried", async () => {
    const { report } = await runDrills({
      root: ROOT,
      mode: "file",
      files: [PINNED],
      head: "late",
      budgetMs: 0,
      policy: POLICY,
    });
    expect(report).toMatchObject({ timeBoxed: true, tried: 0, eligible: 3 });
    expect(report.totals.notTried).toBe(3);
  });

  it("refuses a bare mutation-ok before running anything", async () => {
    const dir = scratch("bare", {
      "bare.ts": "export const a = (x: number) => x > 1; // mutation-ok\n",
    });
    const { report } = await runDrills({
      root: ROOT,
      mode: "file",
      files: [`${dir}/bare.ts`],
      head: "bare",
      policy: POLICY,
    });
    expect(report.notRun).toMatch(/^A bare `\/\/ mutation-ok` at .*bare\.ts:1/);
    expect(describeReport(report).blocking).toBe(true);
  });

  it("caps a run and reports what it did not try", async () => {
    const { report } = await runDrills({
      root: ROOT,
      mode: "file",
      files: [PINNED],
      head: "cap",
      maxMutants: 1,
      policy: POLICY,
    });
    expect(report).toMatchObject({ capped: true, eligible: 3, tried: 1 });
    expect(report.totals.notTried).toBe(2);
  });
});

describe("describe", () => {
  const base = {
    schema: 1,
    mode: "diff",
    policy: { money: "block", safety: "warn" },
    notRun: null,
    capped: false,
    timeBoxed: false,
    eligible: 2,
    tried: 2,
    totals: { killed: 1, survived: 1, uncompilable: 0, accepted: 0, notTried: 0 },
  };
  const survivor = {
    line: 4,
    column: 7,
    operator: "flip a comparison",
    was: "<",
    became: "<=",
    snippet: "if (a < b) {",
  };
  const file = (cls) => ({
    path: "src/lib/x.ts",
    class: cls,
    changedLines: 3,
    testFiles: [],
    killed: 1,
    survivors: [survivor],
    accepted: [],
    uncompilable: 0,
  });

  it("blocks on a survivor in a block class and prints it in plain words", () => {
    const { lines, blocking } = describeReport({ ...base, files: [file("money")] });
    expect(blocking).toBe(true);
    expect(lines).toContain("src/lib/x.ts:4  flip a comparison: < -> <=  | if (a < b) {");
    expect(lines.some((line) => line.includes("add `// mutation-ok: <why>`"))).toBe(true);
  });
  it("warns only for a warn class", () => {
    expect(describeReport({ ...base, files: [file("safety")] }).blocking).toBe(false);
  });
  it("passes when nothing in scope changed", () => {
    expect(
      describeReport({ ...base, notRun: "No money or safety line changed.", files: [] }).blocking,
    ).toBe(false);
  });
});

describe("firstFailingFile", () => {
  it("reads the file a red Vitest run names", () => {
    expect(firstFailingFile(" FAIL  |lib| src/lib/a.test.ts > x\n")).toBe("src/lib/a.test.ts");
    expect(firstFailingFile("all good")).toBeNull();
    // What CI's coloured output looked like: no pipes, the project in a coloured box.
    const coloured =
      "\u001b[41m\u001b[1m FAIL \u001b[22m\u001b[49m \u001b[30m\u001b[46m scripts \u001b[49m\u001b[39m scripts/a/b.test.mjs\u001b[2m > \u001b[22mx";
    expect(firstFailingFile(coloured)).toBe("scripts/a/b.test.mjs");
    expect(firstFailingFile(" FAIL  src/lib/a.test.ts > x\n")).toBe("src/lib/a.test.ts");
  });
});
