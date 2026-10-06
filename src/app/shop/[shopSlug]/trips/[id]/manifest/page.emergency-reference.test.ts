import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **The emergency reference's lift, by where it sits** (pixel-craft K-351
 * follow-up).
 *
 * The manifest renders the card three times: in the phone header's menu, a
 * popover that lifts it with its own shadow; in the desktop footer's
 * disclosure, at rest in the page; and in the print copy, where the print
 * sheet strips every shadow anyway. Only the popover's copy is carried by an
 * overlay, so only it drops the bed (ADR 20260901-diveday-reimagined: "menus,
 * sheets and toasts keep their own lift"). What the card says is the same in
 * all three.
 *
 * Read off the source because this is a server page: there is no render to
 * inspect without a database, a request and a shop.
 */
const SOURCE = readFileSync(join(__dirname, "page.tsx"), "utf8");

const CARDS = SOURCE.split("<EmergencyReferenceCard")
  .slice(1)
  .map((rest) => rest.slice(0, rest.indexOf("/>")));

function card(headingId: string): string {
  const found = CARDS.filter((props) => props.includes(headingId));
  expect(found).toHaveLength(1);
  return found[0];
}

describe("the manifest's emergency reference", () => {
  it("is rendered three times: the phone menu, the desktop footer and paper", () => {
    expect(CARDS).toHaveLength(3);
  });

  it("drops the bed inside the phone header's menu, whose popover lifts it", () => {
    const phone = card("emergency-reference-phone-heading");
    expect(phone).toMatch(/\binOverlay\b/);
    const menu = SOURCE.lastIndexOf("<ManifestMoreMenu", SOURCE.indexOf(phone));
    expect(SOURCE.slice(menu, SOURCE.indexOf(phone))).toContain('variant="header"');
  });

  /**
   * The trip packet and the day's paper both compose this page, so the paper
   * copy here is where the cut boat card's missing-diver procedure and kit
   * blanks print (issue #2035). The procedure ends "call for help on the
   * numbers below", so it sits above the card it points at.
   */
  it("prints the missing-diver procedure above the numbers and the kit blanks below, on paper only", () => {
    const printOnly = SOURCE.indexOf('<div className="hidden print:block">');
    expect(printOnly).toBeGreaterThan(-1);
    const block = SOURCE.slice(printOnly, SOURCE.indexOf("</div>", printOnly));
    const procedure = block.indexOf("<PrintedMissingProcedure");
    const numbers = block.indexOf("emergency-reference-print-heading");
    const blanks = block.indexOf("<PrintedKitBlanks");
    expect(procedure).toBeGreaterThan(-1);
    expect(blanks).toBeGreaterThan(-1);
    expect(procedure).toBeLessThan(numbers);
    expect(numbers).toBeLessThan(blanks);
    expect(SOURCE.split("<PrintedMissingProcedure")).toHaveLength(2);
    expect(SOURCE.split("<PrintedKitBlanks")).toHaveLength(2);
  });

  it("keeps the bed at rest in the desktop footer and on paper", () => {
    expect(card("emergency-reference-desktop-heading")).not.toMatch(/\binOverlay\b/);
    expect(card("emergency-reference-print-heading")).not.toMatch(/\binOverlay\b/);
  });
});
