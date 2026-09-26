import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "page.tsx"), "utf8");

/** The opening tag at `index`, whole — read up to the `>` outside any `{…}`. */
function openingTagAt(index: number): string {
  let depth = 0;
  let end = index;
  for (; end < source.length; end++) {
    const char = source[end];
    if (char === "{") depth++;
    else if (char === "}") depth--;
    else if (depth === 0 && char === ">") break;
  }
  return source.slice(index, end + 1);
}

const cardAt = source.indexOf('<SectionCard title={t("reviews.pulseTitle")}');
const card = openingTagAt(cardAt);
const cardEnd = source.indexOf("</SectionCard>", cardAt);
const panel = source.slice(cardAt, cardEnd);

/**
 * **"Asked us to fix" sits in the page's one section rhythm** (pixel-craft
 * class 4, K-305). The card carried its own `mb-8`, outside the `space-y-10`
 * the groups below it share, so it stood 32px above Waiting while Waiting
 * stood 40px above Published — the per-block margin the page's own comment
 * rules out.
 */
describe("the reviews page's pulse card", () => {
  it("carries no margin of its own", () => {
    expect(cardAt).toBeGreaterThan(-1);
    expect(card).not.toMatch(/\bm[tby]-/);
  });

  it("is a child of a `space-y-10` stack", () => {
    const stack = source.lastIndexOf('<div className="space-y-10">', cardAt);
    expect(stack).toBeGreaterThan(-1);
    // Nothing closes between the stack's opening and the card: the card is in it.
    const between = source.slice(stack + '<div className="space-y-10">'.length, cardAt);
    expect(between).not.toMatch(/<\/div>/);
  });
});

/**
 * **"Mark addressed" sits where the ledger's acts sit** (pixel-craft class 1,
 * K-433). The item hung its act from the top, 9.5px under the title line's
 * middle and 14px over the item's, while Publish below is centred on its row;
 * and on a phone the act wrapped to the start edge where Publish ends at the
 * row's right.
 */
describe("a pulse item's act", () => {
  it("centres on the item from sm up", () => {
    const item = panel.match(/<li\s+key=\{pulse\.id\}\s+className="([^"]*)"/)?.[1];
    expect(item?.split(" ")).toContain("sm:items-center");
  });

  it("ends at the row's right edge when it wraps under the words", () => {
    const formAt = panel.indexOf("<form action={markPulseAddressedAction}");
    const form = panel.slice(formAt, panel.indexOf(">", formAt) + 1);
    expect(form).toMatch(/className="[^"]*\bmax-sm:ms-auto\b/);
  });
});
