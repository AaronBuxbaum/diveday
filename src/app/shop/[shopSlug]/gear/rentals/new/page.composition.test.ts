import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The new-rental form is a Server Component over several reads, so these read
 * its source rather than render it, as the ticket's test does.
 */
const SOURCE = readFileSync(join(__dirname, "page.tsx"), "utf8");
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("the new-rental form", () => {
  /**
   * Issue #2346, H-108: the waiver standing is said while the person is still
   * at the counter choosing gear, beside their cards, with the link to send.
   * It informs and never gates: the rent-out submit knows nothing of it.
   */
  it("says the picked person's waiver beside their cards, and never gates on it", () => {
    expect(CODE).toMatch(/counterRentalWaiverStandings\(db, \{[\s\S]*?personIds: \[personId\]/);
    const cards = CODE.slice(CODE.indexOf("cards={"), CODE.indexOf("/>\n        {person ? ("));
    expect(cards).toContain("<RentalCardSeen");
    expect(cards).toContain("<CounterRentalWaiverLine");
    expect(cards).not.toContain("ticketId=");
    // The whole status, so a clean release standing over a physician's
    // earlier "not cleared" is said here too (dive-domain review, H-98).
    expect(cards).toContain("status={waivers?.get(person.id)}");
    const line = CODE.indexOf("<CounterRentalWaiverLine");
    const afterLine = CODE.slice(CODE.indexOf("/>", line));
    expect(afterLine).not.toMatch(/waiver/i);
  });

  /** Issue 3004: the cart's O2-clean warning starts where the shop's fill method says. */
  it("hands the cart the shop's own nitrox fill method", () => {
    expect(CODE).toContain("nitroxFillMethod={shop.nitroxFillMethod}");
  });
});
