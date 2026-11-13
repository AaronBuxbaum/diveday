// **Every settings destination keeps the settings rail**, and bookkeeper settings live on the
// hub, not on Reports.
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Settings destinations keep their navigation", () => {
  it.each(["boats", "trip-tags", "safety-checklist"])(
    "wraps %s in the shared settings layout",
    async (destination) => {
      const source = await readFile(
        new URL(`../${destination}/layout.tsx`, import.meta.url),
        "utf8",
      );
      expect(source).toContain('export { default } from "../settings/layout"');
    },
  );
  it("keeps the protected dive-site destination outside the settings rail", async () => {
    await expect(
      readFile(new URL("../dive-sites/layout.tsx", import.meta.url), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const source = await readFile(new URL("../dive-sites/page.tsx", import.meta.url), "utf8");
    expect(source).toContain("await requireShopSurface(");
  });
  it("offers bookkeeper settings from the hub and removes the editor from reports", async () => {
    const hub = await readFile(
      new URL("./_components/groups/MoneyGroup.tsx", import.meta.url),
      "utf8",
    );
    const report = await readFile(
      new URL("../reports/_components/MonthMoneyDetail.tsx", import.meta.url),
      "utf8",
    );
    expect(hub).toContain("/settings/bookkeeper");
    expect(report).not.toContain("MonthEndSection");
  });
});
