import { describe, expect, it } from "vitest";
import { routeSource } from "@/test/route-source";

/**
 * The slip is a Server Component over three reads, so these read its source
 * rather than render it, the way `trips/[id]/page.composition.test.ts` reads
 * the departure's. The slip itself is rendered in `RentalSlip.test.tsx`.
 */
const SOURCE = routeSource(import.meta.dirname, "RentalTicketSheet.tsx");
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("the rental slip's foot", () => {
  /**
   * Aaron, 2026-10-08 (ADR 20260815-minimal-gear-register, amended that day):
   * the slip ends with the shop's own rental terms and a "Received by" line,
   * the foot it shares with the counter ticket. A receipt for gear, never a
   * release (CR-015), and no money: billing lives on orders.
   */
  it("ends with the shared terms and received-by foot, and carries no money", () => {
    expect(CODE).toContain("<RentalSlip");
    expect(CODE).toContain("terms={shop.rentalTerms}");
    expect(CODE).not.toMatch(/formatMoney|Cents\b|amount|RentalTicketPayment/i);
  });
});

describe("the rental slip on paper", () => {
  /** Issue #2745: one sheet behind `SheetDocument`, nothing forked for print. */
  it("is a sheet with the way back to the packing list, and no screen-vs-print fork", () => {
    expect(CODE).toContain("<SheetDocument");
    expect(CODE).toContain('shopPath(shopSlug, "trips", tripId, "prep")}#${PREP_SECTION_ID}');
    expect(CODE).toContain('backLabel={t("trips.tabs.gear")}');
    expect(CODE).not.toMatch(/print:|EyebrowWayUp|PrintButton/);
  });
});
