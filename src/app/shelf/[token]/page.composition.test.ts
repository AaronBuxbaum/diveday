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
