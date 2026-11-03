import { describe, expect, it } from "vitest";
import { routeSource } from "@/test/route-source";

/**
 * The dispute sheet is a Server Component over one read and one write, so
 * this reads its source; the sheet itself is rendered in
 * `_components/DisputeSheetPaper.test.tsx`.
 */
const CODE = routeSource(import.meta.dirname, "page.tsx")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "");

describe("the dispute sheet page", () => {
  /** Issue #2390: owner or manager only, and opening it writes the trail line. */
  it("gates on the export permission, then reads, then records the opening", () => {
    expect(CODE).toContain(
      'allow: canPersonExportDisputeSheet,\n    refusal: { notice: "dispute-not-authorized", landing: ["orders", orderId] },',
    );
    const reads = CODE.indexOf("await getDisputeSheet(");
    const missing = CODE.indexOf("if (!sheet) notFound();");
    const records = CODE.indexOf(
      "await recordDisputeSheetOpened(db, shop.id, orderId, session.user.personId);",
    );
    expect(reads).toBeGreaterThan(CODE.indexOf("await requireShopSurface("));
    expect(missing).toBeGreaterThan(reads);
    expect(records).toBeGreaterThan(missing);
  });

  /** Issue #2745: one sheet behind `SheetDocument`, nothing forked for print. */
  it("is a sheet of the shop's paper with the way back to the order, and no fork", () => {
    expect(CODE).toContain("<SheetDocument");
    expect(CODE).toContain("<DisputeSheetPaper sheet={sheet}");
    expect(CODE).toContain('backHref={shopPath(shopSlug, "orders", orderId)}');
    expect(CODE).not.toMatch(/print:|StaffPage|EyebrowWayUp|PrintButton/);
  });
});
