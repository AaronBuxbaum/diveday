import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Where the hand may not go, held mechanically (ADR
 * 20260901-diveday-reimagined, decision 1): **no drawing may appear on a
 * manifest, roll call, cert check, waiver or payment surface**, and coral is
 * banned there outright — never a status, never a fill behind reading text,
 * never on those surfaces at all.
 *
 * Two walks over `src/app` *and* `src/components` — the offline manifest, the
 * boat's own surface, lives in the second and was outside the first version of
 * this net. The first walk catches every importer of anything under
 * `components/illustration/` (the site mark, the swell) plus the course
 * placeholder, which draws a swell of its own; the rule is on the *category*,
 * so a seventh drawing added tomorrow is covered the day it is written. The
 * second catches the coral token itself — any `*-accent` utility or
 * `var(--accent` — on a file whose path names a safety or payment surface.
 * `accent-primary` and `accent-current` are the CSS `accent-color` property on
 * a native checkbox, not the token, and are the one spelling let through.
 */
const SRC = path.resolve(__dirname, "../..");
const ROOTS = ["app", "components"].map((dir) => path.join(SRC, dir));
const SAFETY_SURFACE = /manifest|roll-call|rollcall|cert|waiver|order|payment|checkout|refund/i;
const DRAWING_IMPORT = /components\/illustration\/|\bCourseWavePlaceholder\b/;
const CORAL_TOKEN =
  /(?<![\w-])(?:bg|text|border|fill|stroke|from|via|to|ring|outline|decoration|shadow)-accent(?:-[a-z]+)?(?![\w-])|var\(--accent/;

function sources(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) files.push(full);
    }
  };
  for (const root of ROOTS) walk(root);
  return files;
}

/** Quoted and templated strings only, so a comment naming the rule is not an offender. */
function classStrings(text: string): string[] {
  return text.match(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g) ?? [];
}

function rel(file: string): string {
  return path.relative(SRC, file).split(path.sep).join("/");
}

describe("the illustration hand stays off the safety and payment surfaces", () => {
  const files = sources();

  it("is drawn somewhere, so the walk is proving something", () => {
    const importers = files.filter((file) => DRAWING_IMPORT.test(readFileSync(file, "utf8")));
    expect(importers.length).toBeGreaterThan(2);
  });

  it("is imported by no manifest, roll call, cert, waiver, order or payment file", () => {
    const offenders = files
      .filter((file) => DRAWING_IMPORT.test(readFileSync(file, "utf8")))
      .map(rel)
      .filter((file) => !file.startsWith("components/illustration/"))
      .filter((file) => SAFETY_SURFACE.test(file));
    expect(offenders).toEqual([]);
  });
});

describe("coral never reaches a safety or payment surface", () => {
  it("names no accent token in any class string on those files", () => {
    const offenders = sources()
      .map(rel)
      .filter((file) => SAFETY_SURFACE.test(file))
      .filter((file) =>
        classStrings(readFileSync(path.join(SRC, file), "utf8")).some((s) => CORAL_TOKEN.test(s)),
      );
    expect(offenders).toEqual([]);
  });
});
