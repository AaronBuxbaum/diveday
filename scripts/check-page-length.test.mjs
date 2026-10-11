import { describe, expect, it } from "vitest";

import {
  compareFunctionLengths,
  comparePageLengths,
  countLines,
  FUNCTION_LINE_LIMIT,
  functionCounts,
  measureFunctions,
  nextBaseline,
  PAGE_LINE_LIMIT,
} from "./check-page-length.mjs";

const page = "src/app/shop/[shopSlug]/x/page.tsx";

describe("counting lines", () => {
  it("counts lines the way an editor numbers them", () => {
    expect(countLines("a\nb\nc\n")).toBe(3);
    expect(countLines("a\nb\nc")).toBe(3);
    expect(countLines("")).toBe(0);
  });
});

describe("what it refuses", () => {
  it("refuses a new page over the limit", () => {
    const violations = comparePageLengths(new Map([[page, PAGE_LINE_LIMIT + 1]]), {});
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("over the 400-line limit");
  });

  it("refuses a banked page that grew", () => {
    const violations = comparePageLengths(new Map([[page, 900]]), { [page]: 899 });
    expect(violations[0]).toContain("baseline allows 899");
  });

  it("refuses a banked page that shrank until the fall is banked", () => {
    const violations = comparePageLengths(new Map([[page, 700]]), { [page]: 899 });
    expect(violations[0]).toContain("--write");
  });

  it("refuses a baseline entry for a page that no longer exists", () => {
    const violations = comparePageLengths(new Map(), { [page]: 899 });
    expect(violations[0]).toContain("gone");
  });
});

describe("what it leaves alone", () => {
  it("leaves a page at or under the limit alone", () => {
    expect(comparePageLengths(new Map([[page, PAGE_LINE_LIMIT]]), {})).toEqual([]);
    expect(comparePageLengths(new Map([[page, 12]]), {})).toEqual([]);
  });

  it("leaves a banked page at exactly its banked count alone", () => {
    expect(comparePageLengths(new Map([[page, 899]]), { [page]: 899 })).toEqual([]);
  });
});

describe("writing the baseline", () => {
  it("banks only pages over the limit, sorted by path", () => {
    const counts = new Map([
      ["src/app/b/page.tsx", 500],
      ["src/app/a/page.tsx", 401],
      ["src/app/c/page.tsx", 400],
    ]);
    expect(Object.keys(nextBaseline(counts))).toEqual(["src/app/a/page.tsx", "src/app/b/page.tsx"]);
  });
});

describe("measuring top-level functions", () => {
  const body = (n) => Array.from({ length: n }, (_, i) => `  const v${i} = ${i};`).join("\n");

  it("measures a declaration from its first line to its closing brace", () => {
    const source = `import x from "y";\n\nexport function Row() {\n${body(3)}\n  return null;\n}\n`;
    expect(measureFunctions(source)).toEqual([{ name: "Row", line: 3, lines: 6 }]);
  });

  it("reads past a destructured parameter list's column-0 closers", () => {
    const source = [
      "export function RosterRow({",
      "  entry,",
      "  context,",
      "}: {",
      "  entry: Entry;",
      "  context: Context;",
      "}) {",
      body(4),
      "  return <li />;",
      "}",
      "",
      "function Next() {",
      "  return 1;",
      "}",
    ].join("\n");
    expect(measureFunctions(source)).toEqual([
      { name: "RosterRow", line: 1, lines: 13 },
      { name: "Next", line: 15, lines: 3 },
    ]);
  });

  it("counts arrow functions, wrapped ones, and async defaults", () => {
    const source = [
      "export const load = cache(async (id: string) => {",
      body(2),
      "});",
      "const Row = memo(function Row() {",
      "  return null;",
      "});",
      "export default async function () {",
      "  return 1;",
      "}",
    ].join("\n");
    expect(measureFunctions(source).map(({ name, lines }) => [name, lines])).toEqual([
      ["load", 4],
      ["Row", 3],
      ["default", 3],
    ]);
  });

  it("ends a closer-less arrow on its last indented line, not at a later file's brace", () => {
    const source = [
      "export const double = (n: number) =>",
      "  n * 2;",
      "",
      "export const LIMITS = {",
      "  a: 1,",
      "};",
    ].join("\n");
    expect(measureFunctions(source)).toEqual([{ name: "double", line: 1, lines: 2 }]);
  });

  it("does not take an object, a type or a one-line call for a function", () => {
    const source = [
      "export const config = {",
      "  a: () => 1,",
      "};",
      "type Handler = (a: string) => void;",
      "export const value = compute(3);",
    ].join("\n");
    expect(measureFunctions(source)).toEqual([]);
  });

  it("keys a function by file and name, keeping the longest of an overload set", () => {
    const counts = functionCounts([
      [
        "src/lib/a.ts",
        "export function f(a: string): string;\nexport function f(a) {\n  return a;\n}\n",
      ],
    ]);
    expect(counts.get("src/lib/a.ts#f")).toBe(3);
  });

  it("refuses a new function over its limit with function advice", () => {
    const key = "src/lib/a.ts#f";
    const violations = compareFunctionLengths(new Map([[key, FUNCTION_LINE_LIMIT + 1]]), {});
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("Split it along its sections");
  });

  it("holds a banked function to its count", () => {
    const key = "src/lib/a.ts#f";
    expect(compareFunctionLengths(new Map([[key, 900]]), { [key]: 900 })).toEqual([]);
    expect(compareFunctionLengths(new Map([[key, 901]]), { [key]: 900 })[0]).toContain(
      "baseline allows 900",
    );
  });
});
