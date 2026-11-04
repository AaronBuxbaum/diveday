import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { shops } from "@/db/schema";
import { getShopBackupDestination, listBackupDeliveries } from "@/features/backup-export";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
const { getDb } = await import("@/db/client");
const { POST } = await import("./route");
const ctx = fileScopedShopContext();
const secret = "settings-state-secret";

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("DIVEDAY_E2E_SECRET", secret);
  vi.mocked(getDb).mockResolvedValue(ctx.db);
});
afterEach(() => {
  vi.unstubAllEnvs();
});
const request = () =>
  new Request("http://localhost/api/test/shop", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify({ slug: ctx.shop.slug, facts: ["backupFailed"] }),
  });

it("seeds actual last-success and newer failed-delivery facts without running a provider", async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  const destination = await getShopBackupDestination(ctx.db, ctx.shop.id);
  const latest = await listBackupDeliveries(ctx.db, ctx.shop.id, { page: 1, pageSize: 1 });
  expect(destination?.verifiedAt).not.toBeNull();
  expect(destination?.verifiedAt?.getTime()).toBeLessThan(nowDate().getTime());
  expect(latest.rows[0]).toMatchObject({ status: "failed", errorCode: "network_unreachable" });
  expect(latest.rows[0].startedAt.getTime()).toBeGreaterThan(
    destination?.verifiedAt?.getTime() ?? 0,
  );
});

it("refuses to seed a real shop", async () => {
  await ctx.db.update(shops).set({ isDemo: false }).where(eq(shops.id, ctx.shop.id));
  expect((await POST(request())).status).toBe(404);
});
