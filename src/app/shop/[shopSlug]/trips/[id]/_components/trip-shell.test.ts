import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TRIP_SHELL_CLASS } from "./trip-shell";

/**
 * **Both packets print inside the same gutter.**
 *
 * The trip packet took its paper gutter from the trip layout's `<main>`
 * (`print:px-10 print:py-8`). The day packet (`/shop/<slug>/print`) is not
 * under that layout and rendered its bundle straight into the shop shell, with
 * no `<main>` at all: its ink started at x 1 and y 3, the roll call's tone
 * rule on the paper's edge, where the trip packet's started at x 33 and y 29
 * (pixel probe, `day-packet-print` and `trip-packet-print`). The shell is one
 * class now, worn by the trip layout and by the day packet and its skeleton.
 *
 * Not a gutter on `.trip-print-bundle`: Trip, Manifest and Prep also print on
 * their own through the same layout, so the gutter stays with the shell.
 */
const SHOP = path.join(import.meta.dirname, "..", "..", "..");

const WEARERS = ["trips/[id]/layout.tsx", "print/page.tsx", "print/loading.tsx"] as const;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe("the trip shell", () => {
  it("is the staff work surface on screen and the full sheet less a gutter on paper", () => {
    const classes = TRIP_SHELL_CLASS.split(/\s+/);
    for (const token of [
      "max-w-5xl",
      "px-4",
      "sm:px-6",
      "print:max-w-none",
      "print:px-10",
      "print:py-8",
    ]) {
      expect(classes, token).toContain(token);
    }
  });

  it.each(WEARERS)("is the <main> %s renders", (file) => {
    const source = readFileSync(path.join(SHOP, file), "utf8");
    expect(source).toMatch(/<main className=\{TRIP_SHELL_CLASS\}>/);
  });

  it("is the one place a paper gutter is spelled", () => {
    const spelled = sourceFiles(path.join(SHOP, "..", "..")).filter((file) =>
      /\bprint:p[xy]-(?:8|10)\b/.test(readFileSync(file, "utf8")),
    );
    expect(spelled.map((file) => path.basename(file))).toEqual(["trip-shell.ts"]);
  });
});
