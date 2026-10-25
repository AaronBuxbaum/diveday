import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **The emergency reference is on the manifest wherever the crew read it.**
 *
 * The manifest renders the card three times: in the phone header's menu, in
 * the desktop footer's disclosure, and in the print copy, which carries the
 * missing-diver procedure. What the card says is the same in all three.
 *
 * Read off the source because this is a server page: there is no render to
 * inspect without a database, a request and a shop. The paper copy lives in
 * `PrintedBoatPaper`, which the page renders once.
 */
const SOURCE = readFileSync(join(__dirname, "page.tsx"), "utf8");
const PAPER = readFileSync(join(__dirname, "_components", "PrintedBoatProcedure.tsx"), "utf8");

const CARDS = `${SOURCE}${PAPER}`
  .split("<EmergencyReferenceCard")
  .slice(1)
  .map((rest) => rest.slice(0, rest.indexOf("/>")));

describe("the manifest's emergency reference", () => {
  it("is rendered three times: the phone menu, the desktop footer and paper", () => {
    expect(CARDS).toHaveLength(3);
    expect(SOURCE.split("<PrintedBoatPaper")).toHaveLength(2);
  });

  /**
   * The trip packet and the day's paper both compose this page, so the paper
   * copy here is where the cut boat card's missing-diver procedure and kit
   * blanks print (issue #2035). The procedure ends "call for help on the
   * numbers below", so it sits above the card it points at.
   */
  it("prints the missing-diver procedure above the numbers and the kit blanks below, on paper only", () => {
    const printOnly = PAPER.indexOf('<div data-print-only className="hidden print:block">');
    expect(printOnly).toBeGreaterThan(-1);
    const block = PAPER.slice(printOnly, PAPER.indexOf("</div>", printOnly));
    const procedure = block.indexOf("<PrintedMissingProcedure");
    const numbers = block.indexOf("emergency-reference-print-heading");
    const blanks = block.indexOf("<PrintedKitBlanks");
    expect(procedure).toBeGreaterThan(-1);
    expect(blanks).toBeGreaterThan(-1);
    expect(procedure).toBeLessThan(numbers);
    expect(numbers).toBeLessThan(blanks);
    expect(PAPER.split("<PrintedMissingProcedure")).toHaveLength(2);
    expect(PAPER.split("<PrintedKitBlanks")).toHaveLength(2);
    expect(SOURCE).not.toContain("<PrintedMissingProcedure");
    expect(SOURCE).not.toContain("<PrintedKitBlanks");
  });
});
