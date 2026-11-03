import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TRIP_SHELL_CLASS } from "./trip-shell";

/**
 * **The shell every trip surface is worked in.** The packets used to print
 * inside it too (the day's packet wore it as its own `<main>`); since every
 * packet is a run of sheets (issue #2745) a sheet keeps its own margin, and
 * the shell only has to hold the tabs.
 */
const SHOP = path.join(import.meta.dirname, "..", "..", "..");

const WEARERS = ["trips/[id]/layout.tsx"] as const;

describe("the trip shell", () => {
  it("is a full-width staff page on screen and the full sheet less a gutter on paper", () => {
    const classes = TRIP_SHELL_CLASS.split(/\s+/);
    for (const token of [
      "max-w-6xl",
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
});
