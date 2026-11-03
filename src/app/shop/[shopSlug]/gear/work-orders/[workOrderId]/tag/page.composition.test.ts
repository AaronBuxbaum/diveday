import { describe, expect, it } from "vitest";
import { routeSource } from "@/test/route-source";

/**
 * The claim tag is a Server Component over one read, so this reads its source;
 * the tag itself is rendered in `_components/ClaimTag.test.tsx`.
 */
const CODE = routeSource(import.meta.dirname, "page.tsx")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "");

describe("the claim tag page", () => {
  /** Issue #2745: one sheet behind `SheetDocument`, nothing forked for print. */
  it("is a sheet of the shop's paper with the way back to its ticket, and no fork", () => {
    expect(CODE).toContain("<SheetDocument");
    expect(CODE).toContain("<ShopSheet");
    expect(CODE).toContain("<ClaimTag");
    expect(CODE).toContain('backHref={shopPath(shopSlug, "gear", "work-orders", workOrderId)}');
    expect(CODE).not.toMatch(/print:|EyebrowWayUp|PrintButton/);
  });

  it("keeps its gates: switched off, another shop's, and deleted tickets print nothing", () => {
    expect(CODE).toContain('if (!shop.workOrdersEnabled) redirect(shopPath(shopSlug, "gear"));');
    expect(CODE).toContain("if (!detail) notFound();");
    expect(CODE).toContain("if (detail.workOrder.deletedAt !== null) notFound();");
  });
});
