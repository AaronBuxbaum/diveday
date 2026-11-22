import { describe, expect, it } from "vitest";
import { changedLines } from "./diff.mjs";
import { applyMutant, chooseMutants, isSkippedFile, mutantsFor, OPERATORS } from "./engine.mjs";

const drill = (source, options) => mutantsFor("src/lib/example.ts", source, options);
const kinds = (found) => found.mutants.map((m) => `${m.operator}: ${m.was} -> ${m.became}`);

describe("mutantsFor", () => {
  it("splices at the right character after non-ASCII text (UTF-16 offsets)", () => {
    const source =
      'const label = "héllo 🐠 ünïcode";\nexport const deep = (m: number) => m < 40;\n';
    const flip = drill(source).mutants.find((m) => m.operator === OPERATORS.comparison);
    expect(flip).toMatchObject({ line: 2, column: 38, was: "<", became: "<=" });
    expect(applyMutant(source, flip)).toBe(
      'const label = "héllo 🐠 ünïcode";\nexport const deep = (m: number) => m <= 40;\n',
    );
  });

  it("finds the in-function boundary the kill test drills", () => {
    const found = drill("export function adult(age: number) {\n  return age >= 18;\n}\n");
    expect(kinds(found)).toEqual([
      "return nothing: age >= 18 -> undefined",
      "flip a comparison: >= -> >",
      "change a number: 18 -> 19",
    ]);
    expect(found.mutants[1].snippet).toBe("return age >= 18;");
  });

  it("covers each operator family", () => {
    const source = [
      "export function f(a: number, b: number, ok: boolean, k: string, xs: number[]) {",
      "  let n = a + b * 2 - a / b % 3;",
      "  n += 1;",
      "  if (ok && !ok || a === b) notify(n);",
      "  while (a > b) a -= 1;",
      '  switch (k) { case "x": return xs.some((x) => x != 0) ? Math.min(a, b) : -a; }',
      "  const t = true;",
      "  return a ?? b;",
      "}",
    ].join("\n");
    const ops = new Set(drill(source).mutants.map((m) => m.operator));
    for (const op of Object.values(OPERATORS)) expect(ops, op).toContain(op);
  });

  it("never touches types, enums, keys, directives, specifiers, as const or satisfies targets", () => {
    const source = [
      '"use client";',
      'import { a } from "./a";',
      'export { a as b } from "./b";',
      "type Level = 1 | 2 | true;",
      "interface Box { size: 3 }",
      "enum Tier { Low = 4 }",
      "const map = { 5: 'x', \"key\": 6 > 1 } as const;",
      "const cfg = { max: 7 } satisfies { max: number };",
      "export function g(x: 8 | 9 = 10): x is 11 { return true; }",
    ].join("\n");
    const found = drill(source);
    expect(kinds(found).sort()).toEqual(
      [
        "change a number: 10 -> 11",
        "flip true and false: true -> false",
        "return nothing: true -> undefined",
      ].sort(),
    );
  });

  it("leaves SQL tagged templates and template text alone", () => {
    const source =
      "export function q(a: number) {\n  return sql`select * from t where n > ${a + 1} and ok = ${true}`;\n}\n";
    expect(kinds(drill(source))).toEqual([
      "return nothing: sql`select * from t where n > ${a + 1} and ok = ${true}` -> undefined",
    ]);
  });

  it("does not skip logging, spans or assertions, and does skip other calls", () => {
    const source = [
      "export async function h(db: Db) {",
      "  log.info({ event: 'x' });",
      "  logger.warn('y');",
      "  console.error('z');",
      "  span.setAttribute('a', 1);",
      "  Sentry.captureException(new Error('e'));",
      "  assertNever(db);",
      "  await db.update(1);",
      "  notify();",
      "}",
    ].join("\n");
    const calls = drill(source).mutants.filter((m) => m.operator === OPERATORS.call);
    expect(calls.map((m) => m.line)).toEqual([8, 9]);
    expect(applyMutant(source, calls[0])).toContain("  void 0;\n  notify();");
  });

  it("empties a string only as a comparison operand or a case label", () => {
    const source =
      'export function s(k: string) {\n  const msg = "hello";\n  if (k === "a") return msg;\n  switch (k) { case "b": return 1; }\n  return 0;\n}\n';
    const strings = drill(source).mutants.filter((m) => m.operator === OPERATORS.string);
    expect(strings.map((m) => `${m.line}:${m.was}`)).toEqual(['3:"a"', '4:"b"']);
  });

  it("does not return nothing from a void function or from a bare return", () => {
    const source =
      "export function v(): void { return undefined; }\nexport async function w(): Promise<void> { return run(); }\nexport function u() { return; }\n";
    expect(drill(source).mutants.filter((m) => m.operator === OPERATORS.return)).toEqual([]);
  });

  it("does not swap ?? for || where the default makes them equal", () => {
    const source =
      "export const f = (a?: number[], b?: boolean, c?: { x: 1 }, d?: string) => [a ?? [], b ?? false, c ?? {}, d ?? null];\n";
    const logical = drill(source).mutants.filter((m) => m.operator === OPERATORS.logical);
    expect(logical.map((m) => m.snippet.slice(m.column - 1, m.column + 9))).toEqual(["?? null];"]);
  });

  it("drops a mutant whose text does not parse", () => {
    const found = drill("export const s = 1..toString();\n");
    expect(found.unparsable).toBe(1);
    expect(found.mutants).toEqual([]);
  });

  it("accepts a line marked mutation-ok with a reason, on the line or the line above", () => {
    const source = [
      "export function m(a: number) {",
      "  // mutation-ok: the label text only, no decision",
      "  const label = a > 1;",
      "  const other = a < 2; // mutation-ok: rounding is pinned upstream",
      "  return a === 3;",
      "}",
    ].join("\n");
    const found = drill(source);
    expect(found.accepted).toEqual([
      { line: 3, reason: "the label text only, no decision" },
      { line: 4, reason: "rounding is pinned upstream" },
    ]);
    expect(found.refused).toEqual([]);
    expect(found.mutants.map((m) => m.line).filter((line) => line === 3 || line === 4)).toEqual([]);
  });

  it("refuses a bare or too short mutation-ok", () => {
    const found = drill(
      "export const a = (x: number) => x > 1; // mutation-ok\nexport const b = (x: number) => x > 2; // mutation-ok: tiny\n",
    );
    expect(found.refused).toEqual([{ line: 1 }, { line: 2 }]);
  });

  it("keeps only the changed lines from a synthetic -U0 diff", () => {
    const diff = [
      "diff --git a/src/lib/example.ts b/src/lib/example.ts",
      "--- a/src/lib/example.ts",
      "+++ b/src/lib/example.ts",
      "@@ -2,0 +3 @@ export function f(a: number) {",
      "+  const b = a > 1;",
      "@@ -9 +10,0 @@",
      "-  gone();",
      "diff --git a/src/lib/gone.ts b/src/lib/gone.ts",
      "--- a/src/lib/gone.ts",
      "+++ /dev/null",
      "@@ -1,3 +0,0 @@",
      "-x",
      "diff --git a/src/lib/new.ts b/src/lib/new.ts",
      "--- /dev/null",
      "+++ b/src/lib/new.ts",
      "@@ -0,0 +1,2 @@",
      "+a",
      "+b",
    ].join("\n");
    const changed = changedLines(diff);
    expect([...changed.keys()]).toEqual(["src/lib/example.ts", "src/lib/new.ts"]);
    expect([...changed.get("src/lib/example.ts")]).toEqual([3]);
    expect([...changed.get("src/lib/new.ts")]).toEqual([1, 2]);
    const source =
      "export function f(a: number) {\n  const c = a < 0;\n  const b = a > 1;\n  return b && c;\n}\n";
    const found = drill(source, { lines: changed.get("src/lib/example.ts") });
    expect(kinds(found)).toEqual(["flip a comparison: > -> >=", "change a number: 1 -> 2"]);
  });

  it("skips generated and declaration files", () => {
    expect(isSkippedFile("src/lib/x.d.ts", "")).toBe(true);
    expect(isSkippedFile("src/lib/x.ts", "// @generated by a tool\n")).toBe(true);
    expect(isSkippedFile("src/lib/x.ts", "export const a = 1;\n")).toBe(false);
  });
});

describe("chooseMutants", () => {
  const byFile = new Map([
    ["a.ts", Array.from({ length: 200 }, (_, i) => ({ id: `a${i}` }))],
    ["b.ts", Array.from({ length: 3 }, (_, i) => ({ id: `b${i}` }))],
  ]);
  it("is capped, fair across files and repeatable for one seed", () => {
    const first = chooseMutants(byFile, 150, "abc123");
    expect(first).toHaveLength(150);
    expect(first.filter((m) => m.id.startsWith("b"))).toHaveLength(3);
    expect(chooseMutants(byFile, 150, "abc123").map((m) => m.id)).toEqual(first.map((m) => m.id));
    expect(chooseMutants(byFile, 150, "def456").map((m) => m.id)).not.toEqual(
      first.map((m) => m.id),
    );
  });
  it("takes everything under the cap", () => {
    expect(chooseMutants(byFile, 1000, "x")).toHaveLength(203);
  });
});
