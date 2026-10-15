import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The slip is a Server Component over three reads, so these read its source
 * rather than render it, the way `trips/[id]/page.composition.test.ts` reads
 * the departure's.
 */
const SOURCE = readFileSync(join(__dirname, "page.tsx"), "utf8");

describe("the rental slip's foot", () => {
  /**
   * Aaron, 2026-10-08 (ADR 20260815-minimal-gear-register, amended that day):
   * the slip ends with the shop's own rental terms and a "Received by" line,
   * the foot it shares with the counter ticket. A receipt for gear, never a
   * release (CR-015), and no money: billing lives on orders.
   */
  it("ends with the shared terms and received-by foot, and carries no money", () => {
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).toContain("<RentalTicketReceipt terms={shop.rentalTerms} t={t} />");
    expect(code).not.toMatch(/formatMoney|Cents\b|amount/i);
  });
});
