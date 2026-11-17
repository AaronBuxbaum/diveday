import { describe, expect, it } from "vitest";

import {
  compare,
  fingerprint,
  mirrorsByPath,
  normalize,
  readMirrors,
} from "./check-mockup-mirrors.mjs";

const SOURCE = `
/**
 * **A drawing.**
 *
 * @mirrors src/a/Real.tsx
 * @mirrors src/b/Other.tsx
 */
export function OneFallback() {}

/** No mirrors here. */
export function PlainFallback() {}

/**
 * @mirrors src/a/Real.tsx
 */
export function TwoFallback() {}
`;

describe("which drawings name which screens", () => {
  it("ties each @mirrors line to the function under its docblock", () => {
    expect(readMirrors(SOURCE)).toEqual([
      { path: "src/a/Real.tsx", mock: "OneFallback" },
      { path: "src/b/Other.tsx", mock: "OneFallback" },
      { path: "src/a/Real.tsx", mock: "TwoFallback" },
    ]);
  });

  it("groups the drawings by the screen they mirror", () => {
    expect(mirrorsByPath(readMirrors(SOURCE)).get("src/a/Real.tsx")).toEqual([
      "OneFallback",
      "TwoFallback",
    ]);
  });
});

describe("the fingerprint", () => {
  const screen = `const a = 1; // a note\n/* old */ export const b = "x";\n`;

  it("ignores comments and formatting", () => {
    const reworded = `const a   = 1;\n// a different note\nexport const b =\n  "x";`;
    expect(fingerprint(reworded)).toBe(fingerprint(screen));
    expect(normalize(screen)).toBe('consta=1;exportconstb="x";'.replace(/\s/g, ""));
  });

  it("moves when the code does", () => {
    expect(fingerprint(`${screen}export const c = 2;`)).not.toBe(fingerprint(screen));
  });
});

describe("a screen that changed under its drawing", () => {
  const byPath = mirrorsByPath(readMirrors(SOURCE));
  const pins = { "src/a/Real.tsx": "aaa", "src/b/Other.tsx": "bbb" };

  it("is quiet when every pin matches", () => {
    expect(compare(byPath, { "src/a/Real.tsx": "aaa", "src/b/Other.tsx": "bbb" }, pins)).toEqual(
      [],
    );
  });

  it("names the file and every drawing that mirrors it", () => {
    const [problem, ...rest] = compare(
      byPath,
      { "src/a/Real.tsx": "zzz", "src/b/Other.tsx": "bbb" },
      pins,
    );
    expect(rest).toEqual([]);
    expect(problem).toContain("src/a/Real.tsx");
    expect(problem).toContain("OneFallback, TwoFallback");
  });

  it("fails a screen that is gone, one never pinned, and a pin nothing names", () => {
    const problems = compare(
      byPath,
      { "src/a/Real.tsx": "aaa" },
      { "src/a/Real.tsx": "aaa", "src/c/Stale.tsx": "ccc" },
    );
    expect(problems.join("\n")).toMatch(/src\/b\/Other.tsx: does not exist/);
    expect(problems.join("\n")).toMatch(/src\/c\/Stale.tsx: pinned, but no drawing names it/);
    expect(
      compare(byPath, { "src/a/Real.tsx": "aaa", "src/b/Other.tsx": "bbb" }, {}).join("\n"),
    ).toMatch(/not pinned yet/);
  });
});
