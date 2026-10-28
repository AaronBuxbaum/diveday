import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { listShopFlySafeFollowUps } from "@/db/fly-safe-correction";
import { shops } from "@/db/schema";
import { fileScopedShopContext } from "@/test/db";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
const { getDb } = await import("@/db/client");
const { POST } = await import("./route");
const ctx = fileScopedShopContext();
const secret = "fixture-test-secret";
function request(token = secret) {
  return new Request(
    `http://localhost/api/test/seed-trouble-states?flySafeFollowUp=1&shop=${ctx.shop.slug}`,
    { method: "POST", headers: { authorization: `Bearer ${token}` } },
  );
}
beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("DIVEDAY_E2E_SECRET", secret);
  vi.mocked(getDb).mockResolvedValue(ctx.db);
});
afterEach(() => vi.unstubAllEnvs());

it("seeds synthetic queued and failed guidance only behind the test and demo guards", async () => {
  expect((await POST(request("wrong"))).status).toBe(404);
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await listShopFlySafeFollowUps(ctx.db, { shopId: ctx.shop.id })).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "Queue Diver", status: "queued" }),
      expect.objectContaining({ name: "Contact Diver", status: "follow_up" }),
    ]),
  );
  await ctx.db.update(shops).set({ isDemo: false }).where(eq(shops.id, ctx.shop.id));
  expect((await POST(request())).status).toBe(404);
  await ctx.db.update(shops).set({ isDemo: true }).where(eq(shops.id, ctx.shop.id));
  vi.stubEnv("DATABASE_URL", "postgres://production.invalid/database");
  expect((await POST(request())).status).toBe(404);
});
