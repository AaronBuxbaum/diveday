import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BANNER_TITLE_CLASS, DISPLAY_TITLE_CLASS, SUB_TITLE_CLASS } from "./typography";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("the reading ramp's wrap rules", () => {
  it("never leaves a sub-title's last word alone on its line", () => {
    // "Sizes" sat alone under a product-page h3 at 390 (K-132): the two rungs
    // above balance their wrap, and this one had no rule at all. `pretty` and
    // not `balance`: a sub-title often runs to three lines in a narrow grid
    // cell, where balancing would pull every line short.
    expect(SUB_TITLE_CLASS.split(" ")).toContain("text-pretty");
    expect(DISPLAY_TITLE_CLASS.split(" ")).toContain("text-balance");
    expect(BANNER_TITLE_CLASS.split(" ")).toContain("text-balance");
  });

  it("owns the rung's wrap: no call site adds a second one beside it", () => {
    // Two `text-wrap` utilities on one element are decided by stylesheet
    // order, not by the order they are written in, so a call site's own
    // `text-balance` beside the rung's `text-pretty` is a coin flip.
    const offenders = sourceFiles(SRC)
      .filter((file) =>
        /\$\{SUB_TITLE_CLASS\}[^`]*\btext-(?:balance|pretty|wrap|nowrap)\b|\btext-(?:balance|pretty)\b[^`]*\$\{SUB_TITLE_CLASS\}/.test(
          readFileSync(file, "utf8"),
        ),
      )
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });
});
