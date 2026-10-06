import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "page.tsx"), "utf8");

/** The source of the one `<details>` whose summary is `marker`'s, open tag to close. */
function detailsAround(marker: string): string {
  const at = source.indexOf(marker);
  expect(at, `no ${marker} in gear/[id]/page.tsx`).toBeGreaterThan(-1);
  const open = source.lastIndexOf("<details", at);
  const close = source.indexOf("</details>", at);
  return source.slice(open, close + "</details>".length);
}

function summaryOf(details: string): string {
  return details.slice(details.indexOf("<summary"), details.indexOf("</summary>"));
}

const service = detailsAround('t("gear.unit.service.logDoor")');
const history = detailsAround("gear.unit.history.title");

/**
 * **The unit's Service card draws its two disclosures one way** (pixel-craft
 * class 12, K-302). "Log a service ⌄" is a link-weight door with a caret;
 * "History (2)" was a bare 14px label on a flex summary, which drops the
 * browser's marker, so nothing said it opened.
 */
describe("the gear unit's history disclosure", () => {
  it("is summarized the way the card's service door is, caret and all", () => {
    expect(history).toMatch(/^<details[^>]*className="[^"]*\bgroup\b/);
    const door = summaryOf(service);
    const buttonCall = door.match(/buttonClass\(\{[\s\S]*?\}\)/)?.[0];
    expect(buttonCall).toBeDefined();
    expect(summaryOf(history)).toContain(buttonCall as string);
    expect(summaryOf(history)).toContain(
      '<DisclosureCaret direction="down" className="group-open:rotate-180" />',
    );
  });

  /**
   * **Its rows keep the list's rules inside the card's rhythm** (pixel-craft
   * class 5, K-432). `py-3` on every entry put 12px of padding above the first
   * one and under the last, on top of the summary's own tap-floor slack and
   * the card's padding: 41px above and below a lone entry, against 27–31px
   * between everything else on the card.
   */
  it("pads between its entries, never above the first or under the last", () => {
    const row = history.match(/<li key=\{event\.id\} className="([^"]*)"/)?.[1];
    expect(row?.split(" ")).toEqual(expect.arrayContaining(["py-3", "first:pt-0", "last:pb-0"]));
  });
});
