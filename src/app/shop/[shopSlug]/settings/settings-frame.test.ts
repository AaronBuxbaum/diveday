import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Settings destinations keep their navigation", () => {
  it.each(["boats", "dive-sites", "trip-tags", "safety-checklist", "waivers"])(
    "wraps %s in the shared settings layout",
    async (destination) => {
      const source = await readFile(
        new URL(`../${destination}/layout.tsx`, import.meta.url),
        "utf8",
      );
      expect(source).toContain('export { default } from "../settings/layout"');
    },
  );
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
