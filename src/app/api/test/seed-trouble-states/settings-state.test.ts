import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { shops } from "@/db/schema";
import { getShopBackupDestination, listBackupDeliveries } from "@/features/backup-export";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { settingsStateResponse } from "./settings-state";

const ctx = fileScopedShopContext();
// The shop is resolved through `requireDemoTenant`, which asks the harness
// gate again, so the request carries the bearer the parent route checks.
beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("DIVEDAY_E2E_SECRET", "settings-state-secret");
});
afterEach(() => {
  vi.unstubAllEnvs();
});
const request = () =>
  new Request("http://localhost/api/test/seed-trouble-states?settingsState=backup-failed", {
    method: "POST",
    headers: { authorization: "Bearer settings-state-secret" },
  });

it("seeds actual last-success and newer failed-delivery facts without running a provider", async () => {
  const response = await settingsStateResponse(request(), ctx.db);
  expect(response?.status).toBe(200);
  const destination = await getShopBackupDestination(ctx.db, ctx.shop.id);
  const latest = await listBackupDeliveries(ctx.db, ctx.shop.id, { page: 1, pageSize: 1 });
  expect(destination?.verifiedAt).not.toBeNull();
  expect(destination?.verifiedAt?.getTime()).toBeLessThan(nowDate().getTime());
  expect(latest.rows[0]).toMatchObject({ status: "failed", errorCode: "network_unreachable" });
  expect(latest.rows[0].startedAt.getTime()).toBeGreaterThan(
    destination?.verifiedAt?.getTime() ?? 0,
  );
});

it("refuses to seed a real shop even when invoked behind the test route gate", async () => {
  await ctx.db.update(shops).set({ isDemo: false }).where(eq(shops.id, ctx.shop.id));
  expect((await settingsStateResponse(request(), ctx.db))?.status).toBe(404);
});
