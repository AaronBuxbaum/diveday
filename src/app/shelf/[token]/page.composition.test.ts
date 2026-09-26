import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **The shelf's rhythm**, pinned from the route's source: the page is a server
 * component behind a bearer token, so there is no render to measure without a
 * database and a live link. Same shape as
 * `src/app/ready/[token]/page.composition.test.ts`, for the same reason.
 */

const SOURCE = readFileSync(join(__dirname, "page.tsx"), "utf8");
const SKELETON = readFileSync(join(__dirname, "loading.tsx"), "utf8");

describe("the file card's two subsections", () => {
  it("open at one gap after what precedes them", () => {
    // "Sizes" sat 44px under the last fact row and "Emergency contact" 38px
    // under the Save above it: the sizes form was `mt-6` after a row that
    // kept its `py-3`, the contact form `mt-8` after a button (K-597).
    for (const action of ["saveShelfSizesAction", "saveShelfEmergencyContactAction"]) {
      const at = SOURCE.indexOf(`<form action={${action}`);
      expect(at, action).toBeGreaterThan(-1);
      expect(SOURCE.slice(at, SOURCE.indexOf(">", at)), action).toContain('className="mt-8"');
    }
  });

  it("lets the last fact row add no space it does not fill", () => {
    // `last:min-h-0` as well as `last:pb-0`: without it the row's `min-h-11`
    // hands back 8 of the 12px the padding gave up.
    const row = /function Row\([\s\S]*?className="([^"]+)"/.exec(SOURCE)?.[1] ?? "";
    expect(row.split(" ")).toEqual(expect.arrayContaining(["last:pb-0", "last:min-h-0"]));
  });
});

describe("the shelf under its heading", () => {
  it("opens its first card 32px under the title, as its skeleton does", () => {
    // `ThreadShell` closes its header straight into its children, and the
    // shelf's stack had no top margin: the first card's border sat on the
    // h1's line box, 0px under it (K-479). `/ready` and `/recap` open 32px
    // down, and the shelf's own skeleton always had.
    const shell = SOURCE.indexOf("<ThreadShell");
    const stack = SOURCE.slice(shell, SOURCE.indexOf("<ReasonsToComeBack", shell));
    expect(stack).toContain('<div className="mt-8 space-y-10">');
    expect(SKELETON).toContain('<div className="mt-8 space-y-4">');
  });
});
