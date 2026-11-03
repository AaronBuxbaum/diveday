import { describe, expect, it } from "vitest";
import { routeSource } from "@/test/route-source";

/**
 * The blank release is a Server Component over one read, so this reads its
 * source; the release itself is rendered in `BlankRelease.test.tsx`.
 */
const CODE = routeSource(import.meta.dirname, "page.tsx")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "");

describe("the blank release page", () => {
  it("keeps the editor's gate: the release is owner and manager work", () => {
    expect(CODE).toContain(
      'allow: canPersonManageWaiverTemplates,\n    refusal: { notice: "waivers-not-authorized" },',
    );
    expect(CODE).toContain('if (!current) redirect(shopPath(shopSlug, "waivers"));');
  });

  /** Issue #2745: one sheet behind `SheetDocument`, nothing forked for print. */
  it("is a sheet of the shop's paper around the release, and no fork", () => {
    expect(CODE).toContain("<SheetDocument");
    const sheet = CODE.indexOf("<ShopSheet");
    expect(sheet).toBeGreaterThan(-1);
    expect(CODE.indexOf("<BlankRelease")).toBeGreaterThan(sheet);
    expect(CODE).not.toMatch(/print:|StaffPage|AutoPrint|PrintButton/);
  });
});
