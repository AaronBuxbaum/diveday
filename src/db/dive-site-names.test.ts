import { expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { deleteDiveSite, listDiveSiteNames, listDiveSites } from "./dive-sites";

const ctx = fileScopedShopContext();

it("projects only live site identities and names for a picker", async () => {
  const { db, shop } = ctx;
  const sites = await listDiveSites(db, shop.id);
  expect(sites.length).toBeGreaterThan(0);
  const removed = sites[0];
  if (!removed) throw new Error("seeded site missing");
  await deleteDiveSite(db, shop.id, removed.id);
  expect(await listDiveSiteNames(db, shop.id)).toEqual(
    sites.filter((site) => site.id !== removed.id).map(({ id, name }) => ({ id, name })),
  );
  expect(await listDiveSiteNames(db, "00000000-0000-4000-8000-000000000000")).toEqual([]);
});
