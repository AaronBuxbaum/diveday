import { describe, expect, it } from "vitest";

import {
  compareFileLengths,
  compareFunctionLengths,
  comparePageLengths,
  countCodeLines,
  countLines,
  FILE_LINE_LIMIT,
  FUNCTION_LINE_LIMIT,
  functionCounts,
  measureFunctions,
  NEAR_LIMIT_BAND,
  nearLimit,
  nextBaseline,
  PAGE_LINE_LIMIT,
} from "./check-page-length.mjs";
import { LARGE_FILE_LINES } from "./guard-read.mjs";

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
    expect(measureFunctions(source)).toEqual([{ name: "Row", line: 3, lines: 6, code: 6 }]);
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
      { name: "RosterRow", line: 1, lines: 13, code: 13 },
      { name: "Next", line: 15, lines: 3, code: 3 },
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
    expect(measureFunctions(source)).toEqual([{ name: "double", line: 1, lines: 2, code: 2 }]);
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

  it("charges a function for its code lines, not its comments", () => {
    const source = [
      "export function Documented() {",
      "  // Why the next line exists.",
      "  /**",
      "   * A long explanation,",
      "   * over several lines.",
      "   */",
      "  const a = 1;",
      "",
      "  return (",
      "    <div>",
      "      {/* A JSX note. */}",
      "      {/*",
      "        A longer JSX note.",
      "      */}",
      "      {a}",
      "    </div>",
      "  );",
      "}",
    ].join("\n");
    const [measured] = measureFunctions(source);
    expect(measured.lines).toBe(18);
    expect(measured.code).toBe(8);
    expect(functionCounts([["src/lib/a.tsx", source]]).get("src/lib/a.tsx#Documented")).toBe(8);
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

describe("counting code lines", () => {
  it("leaves out blank lines, line comments and block comments", () => {
    expect(countCodeLines(["const a = 1;", "", "  // note", "/* one */", "/**", " * two", " */"])).toBe(
      1,
    );
  });

  it("counts code after a closing block comment and code with a trailing comment", () => {
    expect(countCodeLines(["/* a", "b */ const c = 1;", "const d = 2; // why"])).toBe(2);
  });

  it("does not take a URL inside a string for a comment", () => {
    expect(countCodeLines(['  const url = "https://example.com";'])).toBe(1);
  });
});

describe("the file half", () => {
  const file = "src/components/Big.tsx";

  it("uses the read guard's own number", () => {
    expect(FILE_LINE_LIMIT).toBe(LARGE_FILE_LINES);
  });

  it("refuses a new file over the read guard's limit, and leaves one at it alone", () => {
    const violations = compareFileLengths(new Map([[file, FILE_LINE_LIMIT + 1]]), {});
    expect(violations[0]).toContain("sibling file");
    expect(compareFileLengths(new Map([[file, FILE_LINE_LIMIT]]), {})).toEqual([]);
  });

  it("holds a banked file to its count", () => {
    expect(compareFileLengths(new Map([[file, 1001]]), { [file]: 1000 })[0]).toContain(
      "baseline allows 1000",
    );
    expect(compareFileLengths(new Map([[file, 1000]]), { [file]: 1000 })).toEqual([]);
  });
});

describe("near the limit", () => {
  it("warns about an unbanked entry within the band, longest first", () => {
    const counts = new Map([
      ["a#f", FUNCTION_LINE_LIMIT - NEAR_LIMIT_BAND + 1],
      ["b#g", FUNCTION_LINE_LIMIT],
    ]);
    const warnings = nearLimit(counts, {}, FUNCTION_LINE_LIMIT);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/^b#g: 300 of 300/);
  });

  it("leaves alone an entry below the band, over the limit, or already banked", () => {
    const counts = new Map([
      ["low#f", FUNCTION_LINE_LIMIT - NEAR_LIMIT_BAND],
      ["over#f", FUNCTION_LINE_LIMIT + 1],
      ["banked#f", FUNCTION_LINE_LIMIT - 1],
    ]);
    expect(nearLimit(counts, { "banked#f": 290 }, FUNCTION_LINE_LIMIT)).toEqual([]);
  });
});
