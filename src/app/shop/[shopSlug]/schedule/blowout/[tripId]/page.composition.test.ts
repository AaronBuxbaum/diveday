import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **How the blow-out cascade's table lays out a diver.**
 *
 * It reads the page's source because the page is a server component that
 * needs a database, a session and a called blow-out to render; there is no
 * render to inspect without them. Same shape as `page.notices.test.ts` on
 * Today and `src/app/waivers/[token]/page.composition.test.ts`, for the same
 * reason. The rendered geometry is the pixel probe's (`blowout-cascade`).
 */
const PAGE = readFileSync(join(__dirname, "page.tsx"), "utf8");

/** The table body, from `<TBody>` to `</TBody>`. */
function tableBody(): string {
  const start = PAGE.indexOf("<TBody>");
  const end = PAGE.indexOf("</TBody>");
  expect(start, "the page renders a table body").toBeGreaterThan(-1);
  return PAGE.slice(start, end);
}

/**
 * **The diver's name is the row's door, and a thumb-sized one** (principles.md
 * §2; pixel-craft class 7, K-322). It was a plain `Link` around the name, a
 * 17–37px target on all nine rows at 390. `RowLink` is the table's own door —
 * a 44px floor and an overlay across the cell — and its overlay positions
 * against `Tr`'s `relative`, so a row that holds one is a `Tr`.
 */
describe("the diver cell", () => {
  it("opens the diver through the table's RowLink", () => {
    expect(tableBody()).toMatch(
      /<RowLink\s+href=\{shopPath\(shopSlug, "divers", diver\.personId\)\}/,
    );
    expect(tableBody()).not.toMatch(/<Link\b/);
  });

  it("sets each diver in the table's Tr, which the link's overlay positions against", () => {
    expect(tableBody()).toMatch(/<Tr key=\{diver\.id\}>/);
    expect(tableBody()).not.toMatch(/<tr\b/);
  });
});
