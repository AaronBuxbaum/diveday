import { expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { pagedOrdersByDay } from "./orders";

const ctx = fileScopedShopContext();

it("reads a typed % or _ in the orders search as a character, not a wildcard", async () => {
  const { db, shop } = ctx;
  for (const q of ["%", "_"]) {
    const wild = await pagedOrdersByDay(db, shop.id, "America/New_York", { q }, { pageSize: 20 });
    expect(wild.page.total).toBe(0);
  }
});
