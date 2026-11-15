import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { loadShopExportBundleInput } from "./export";
import { shops } from "./schema";

const ctx = fileScopedShopContext();

describe("the shop's buddy planning preference", () => {
  it.each([true, false])("exports the actual %s preference", async (enabled) => {
    await ctx.db.update(shops).set({ buddyTeamsEnabled: enabled }).where(eq(shops.id, ctx.shop.id));
    const bundle = await loadShopExportBundleInput(ctx.db, ctx.shop.id);
    const shop = bundle?.tables.find((table) => table.file === "shop.csv");
    expect(shop).toBeDefined();
    const column = shop?.header.indexOf("buddy_teams_enabled") ?? -1;
    expect(column).toBeGreaterThanOrEqual(0);
    expect(shop?.rows[0]?.[column]).toBe(enabled);
  });
});
