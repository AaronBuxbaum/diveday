import { expect, it } from "vitest";
import { fileScopedShopContext } from "../test/db";
import { countDiveSites, listDiveSites } from "./dive-sites";

const ctx = fileScopedShopContext();

it("counts exactly the live dive sites a shop lists", async () => {
  const { db, shop } = ctx;
  const listed = await listDiveSites(db, shop.id);
  expect(listed.length).toBeGreaterThan(0);
  expect(await countDiveSites(db, shop.id)).toBe(listed.length);
});
