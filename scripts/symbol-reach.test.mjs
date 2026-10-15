import { describe, expect, it } from "vitest";

import { changedLinesByFile, moduleIndex, parseModule, symbolReach } from "./symbol-reach.mjs";

const lines = (...text) => text.join("\n");

/** Reach from `seeds` ({ file: [lines] | "all" }) over `tree`, as { file: exports }. */
function reach(tree, seeds, options) {
  const modules = moduleIndex(new Map(Object.entries(tree)));
  const touched = symbolReach(
    modules,
    new Map(Object.entries(seeds).map(([file, at]) => [file, at === "all" ? at : new Set(at)])),
    options,
  );
  return Object.fromEntries(
    [...touched].map(([file, exports]) => [file, exports === "all" ? "all" : [...exports].sort()]),
  );
}

const LIB = lines(
  'import { slugify } from "./text";', // 1
  "", // 2
  "/** Calls nothing; mentions courseTitle only in prose. */", // 3
  "export function gearTitle() {", // 4
  '  return slugify("gear");', // 5
  "}", // 6
  "", // 7
  "function shared() {", // 8
  '  return "shared";', // 9
  "}", // 10
  "", // 11
  "export function courseTitle() {", // 12
  "  return shared();", // 13
  "}", // 14
);

describe("reading a module", () => {
  it("splits it into top-level items with what each declares, imports and exports", () => {
    const parsed = parseModule(
      "src/lib/a.ts",
      lines(
        '"use client";',
        "import {",
        "  one,",
        "  type Two,",
        '} from "./b";',
        'import Three, * as four from "./c";',
        'export { five } from "./b";',
        'export * from "./c";',
        "export const six = 6;",
        "export default function Seven() {}",
        "const eight = 8;",
        "export { eight as nine };",
      ),
      (_from, spec) => `src/lib/${spec.slice(2)}.ts`,
    );
    expect(parsed.items.map((item) => item.kind)).toEqual([
      "statement",
      "import",
      "import",
      "reexport",
      "reexport",
      "declaration",
      "declaration",
      "declaration",
      "exportList",
    ]);
    expect(parsed.imports.map(({ local, imported }) => `${local}<${imported}`)).toEqual([
      "one<one",
      "Two<Two",
      "Three<default",
      "four<*",
    ]);
    expect(parsed.reexports).toEqual([
      { exported: "five", target: "src/lib/b.ts", imported: "five" },
    ]);
    expect(parsed.stars).toEqual(["src/lib/c.ts"]);
    expect(parsed.items[5].exports).toEqual(["six"]);
    expect(parsed.items[6].exports).toEqual(["default"]);
  });

  it("reads a diff's new-side lines per file", () => {
    const diff = lines(
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -3,0 +4,2 @@",
      "+x",
      "+y",
      "@@ -9 +11,0 @@",
      "-z",
      "diff --git a/src/gone.ts b/src/gone.ts",
      "--- a/src/gone.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
    );
    expect([...changedLinesByFile(diff)].map(([file, at]) => [file, [...at]])).toEqual([
      ["src/a.ts", [4, 5, 11, 12]],
    ]);
  });
});

describe("what an edit reaches, by name", () => {
  const tree = {
    "src/lib/text.ts": "export function slugify(s) {\n  return s;\n}",
    "src/lib/lib.ts": LIB,
    "src/app/gear/page.tsx": lines(
      'import { gearTitle } from "@/lib/lib";',
      "export default function Page() {",
      "  return gearTitle();",
      "}",
    ),
    "src/app/courses/page.tsx": lines(
      'import { courseTitle } from "@/lib/lib";',
      "export default function Page() {",
      "  return courseTitle();",
      "}",
    ),
  };

  it("reaches the readers of the declaration whose lines changed, and no other", () => {
    expect(reach(tree, { "src/lib/lib.ts": [5] })).toEqual({
      "src/lib/lib.ts": ["gearTitle"],
      "src/app/gear/page.tsx": ["default"],
    });
  });

  it("follows a private helper to the exports that call it", () => {
    expect(Object.keys(reach(tree, { "src/lib/lib.ts": [9] }))).toEqual([
      "src/lib/lib.ts",
      "src/app/courses/page.tsx",
    ]);
  });

  it("follows a changed import to the code that reads it, across modules", () => {
    expect(Object.keys(reach(tree, { "src/lib/text.ts": [2] }))).toEqual([
      "src/lib/text.ts",
      "src/lib/lib.ts",
      "src/app/gear/page.tsx",
    ]);
  });

  it("ignores a comment, and a name mentioned only in a docblock", () => {
    expect(reach(tree, { "src/lib/lib.ts": [3] })).toEqual({});
    expect(Object.keys(reach(tree, { "src/lib/lib.ts": [13] }))).not.toContain(
      "src/app/gear/page.tsx",
    );
  });

  it("treats a changed module-level statement as the whole module", () => {
    const withStatement = { ...tree, "src/lib/lib.ts": `${LIB}\nregister(gearTitle);` };
    expect(reach(withStatement, { "src/lib/lib.ts": [15] })["src/lib/lib.ts"]).toBe("all");
  });

  it("passes through a barrel only the names a reader takes from it", () => {
    const barrel = {
      ...tree,
      "src/lib/index.ts": 'export { gearTitle } from "./lib";\nexport * from "./text";',
      "src/app/gear/page.tsx": lines(
        'import { gearTitle } from "@/lib/index";',
        "export default function Page() {",
        "  return gearTitle();",
        "}",
      ),
      "src/app/slug/page.tsx": lines(
        'import { slugify } from "@/lib/index";',
        "export default function Page() {",
        "  return slugify();",
        "}",
      ),
    };
    expect(Object.keys(reach(barrel, { "src/lib/lib.ts": [5] }))).toEqual([
      "src/lib/lib.ts",
      "src/lib/index.ts",
      "src/app/gear/page.tsx",
    ]);
    expect(Object.keys(reach(barrel, { "src/lib/text.ts": [2] }))).toContain(
      "src/app/slug/page.tsx",
    );
  });

  it("counts an import line by its bindings: a rewrap is nothing, a new binding is a change", () => {
    const wrapped = {
      ...tree,
      "src/lib/lib.ts": LIB.replace(
        'import { slugify } from "./text";',
        'import {\n  slugify,\n} from "./text";',
      ),
    };
    const before = () => LIB;
    expect(reach(wrapped, { "src/lib/lib.ts": [1, 2, 3] }, { before })).toEqual({});
    expect(Object.keys(reach(wrapped, { "src/lib/lib.ts": [1, 2, 3] }))).toContain(
      "src/app/gear/page.tsx",
    );
  });

  it("taints only the function that runs a dynamic import of a touched module", () => {
    const dynamic = {
      ...tree,
      "src/lib/lazy.ts": lines(
        "export function load() {",
        '  return import("./text");',
        "}",
        "",
        "export function other() {",
        "  return 1;",
        "}",
      ),
    };
    expect(reach(dynamic, { "src/lib/text.ts": [2] })["src/lib/lazy.ts"]).toEqual(["load"]);
  });

  it("reads a whole module as changed when told so", () => {
    expect(Object.keys(reach(tree, { "src/lib/lib.ts": "all" }))).toEqual([
      "src/lib/lib.ts",
      "src/app/gear/page.tsx",
      "src/app/courses/page.tsx",
    ]);
  });
});
