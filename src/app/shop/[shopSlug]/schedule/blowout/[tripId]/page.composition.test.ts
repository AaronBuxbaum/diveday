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
 *
 * That overlay covers the cell it sits in, and the "Call {phone}" line for a
 * diver with no email sits in the same cell. Under it, every tap on the number
 * opened the record and the number could not be selected or tapped to call, on
 * the one page whose job is reaching the divers the cascade could not email.
 * So the line is lifted over the overlay, as `LedgerRow` lifts its trailing
 * slot.
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

  it("lifts the call line above the name's overlay, so the number stays reachable", () => {
    expect(tableBody()).toMatch(
      /<div className="relative z-10 text-xs text-muted">\s*\{t\("blowout\.record\.callThem"/,
    );
  });

  /**
   * **The number to call is one run** (pixel-craft class 8, K-450). "Call
   * +1 305 555 0142" sits in the name's cell at 12px, and a narrow column
   * broke inside the number: "+1 305 555" over "0142" is a different number to
   * somebody dialling it off the screen. `displayStoredPhoneWhole` is the same
   * reading with no-break spaces, as every other line that sets a number
   * beside other words wears it.
   */
  it("keeps the number in the call line whole", () => {
    expect(tableBody()).toMatch(/phone: displayStoredPhoneWhole\(diver\.phone\)/);
    expect(tableBody()).not.toMatch(/displayStoredPhone\(/);
  });
});

/**
 * **One offer per line, its date whole** (pixel-craft class 8, K-323). The
 * offers were one string joined with " · " in a ~163px column, so two or
 * three dates broke across lines on every row ("Wed," / "Jul 22"). Each
 * offer is a list item now, and its date one unbreakable run: only a title
 * may wrap.
 */
describe("the Offered column", () => {
  it("lists the offers rather than joining them into one run", () => {
    expect(tableBody()).not.toMatch(/\.join\(/);
    expect(tableBody()).toMatch(
      /diver\.offeredTrips\.map\(\(offer\) => \(\s*<li key=\{offer\.id\}>/,
    );
  });

  it("keeps each offer's date on one line", () => {
    expect(tableBody()).toMatch(
      /<span className="whitespace-nowrap">\s*\{formatShortDate\(offer\.startsAt, locale, shop\.timezone\)\}\s*<\/span>/,
    );
  });
});
