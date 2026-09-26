import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tapTargetLinkClass } from "@/components/ui/button";

/**
 * **The staff bar over a shop's public pages** ("You work here. … Open the
 * board", pixel-craft K-272). Rendering it needs a signed-in staffer on a live
 * shop, so this reads the source; what it pins is the bar's arithmetic.
 *
 * The link is a 44px target (`tapTargetLinkClass`), and its focus ring draws
 * 5px outside that box (3px at a 2px offset). For a staffer on their own live
 * shop no demo banner renders, so the bar is the first thing on the page.
 * With no padding the box was the bar's whole height: from `sm` the ring's
 * top band sat off the page and its bottom band crossed the bar's border into
 * the sticky chrome under it.
 */
const SOURCE = readFileSync(join(__dirname, "PublicShopShell.tsx"), "utf8");

function staffBar(): string {
  const start = SOURCE.indexOf("{showStaffBar && shop ? (");
  expect(start).toBeGreaterThan(-1);
  return SOURCE.slice(start, SOURCE.indexOf(") : null}", start));
}

/** The class tokens of the `nth` literal `className="…"` in the bar. */
function classesAt(nth: number): string[] {
  const literals = [...staffBar().matchAll(/className="([^"]*)"/g)].map((match) => match[1]);
  expect(literals.length).toBeGreaterThan(nth);
  return literals[nth].split(/\s+/);
}

/** A spacing token's size in px, or null when the bar has none of that kind. */
function spacing(tokens: string[], utility: string): number | null {
  const token = tokens.find((candidate) => candidate.startsWith(`${utility}-`));
  return token ? Number(token.slice(utility.length + 1)) * 4 : null;
}

const RING = 5;

describe("the public staff bar", () => {
  const row = () => classesAt(1);
  const sentence = () => classesAt(2);

  it("makes the link a 44px target", () => {
    expect(staffBar()).toMatch(/className=\{`\$\{tapTargetLinkClass\} /);
    expect(tapTargetLinkClass).toContain("min-h-11");
  });

  it("keeps the link's whole ring inside the bar, above and below", () => {
    // From `sm` that is 6 + 44 + 6, the 56px of the chrome bar under it.
    expect(spacing(row(), "py")).toBeGreaterThanOrEqual(RING);
  });

  it("keeps the link's ring off the sentence when they share a row", () => {
    // `gap-2` was the column gap too. Dropping it put the two 0 to 7px apart
    // at 410 to 417px wide, 2px at 412, before they wrap.
    expect(spacing(row(), "gap-x")).toBeGreaterThanOrEqual(RING);
  });

  it("keeps the link's ring off the sentence when it wraps under it on a phone", () => {
    expect(spacing(row(), "gap-y")).toBeGreaterThanOrEqual(RING);
  });

  it("stands the sentence 44px tall only where it shares the link's row", () => {
    // On a phone the sentence is a line of its own, and a 44px floor there
    // only grew the bar (to 88px); from `sm` it sits level with the link.
    expect(sentence()).toContain("sm:min-h-11");
    expect(sentence()).not.toContain("min-h-11");
  });
});
