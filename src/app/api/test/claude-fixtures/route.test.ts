import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shops } from "@/db/schema";
import { e2eClaudeFixtureProvider } from "@/lib/assists/e2e-fixtures";
import { fileScopedShopContext } from "@/test/db";

const ctx = fileScopedShopContext();

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});

const { getDb } = await import("@/db/client");
const { DELETE, POST } = await import("./route");

const secret = "e2e-test-secret";
const slug = "claude-fixtures-minted";

function fixturesRequest(method: "POST" | "DELETE") {
  return new Request(`http://localhost/api/test/claude-fixtures?slug=${slug}`, {
    method,
    headers: { authorization: `Bearer ${secret}` },
  });
}

async function isDemo(): Promise<boolean | undefined> {
  const [row] = await ctx.db
    .select({ isDemo: shops.isDemo })
    .from(shops)
    .where(eq(shops.id, ctx.shop.id));
  return row?.isDemo;
}

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("DIVEDAY_E2E", "1");
  vi.stubEnv("DIVEDAY_E2E_SECRET", secret);
  vi.mocked(getDb).mockResolvedValue(ctx.db);
  // The seeded shop is the canonical fixture the route refuses; give it a minted slug.
  await ctx.db.update(shops).set({ slug, isDemo: true }).where(eq(shops.id, ctx.shop.id));
});

afterEach(async () => {
  // Leave the shop disarmed whichever way the test went.
  await DELETE(fixturesRequest("DELETE"));
  vi.unstubAllEnvs();
});

describe("/api/test/claude-fixtures", () => {
  it("arms a minted demo, and DELETE disarms it and makes it a demo again", async () => {
    expect((await POST(fixturesRequest("POST"))).status).toBe(200);
    expect(await isDemo()).toBe(false);
    expect(e2eClaudeFixtureProvider(ctx.shop.id)).not.toBeNull();

    expect((await DELETE(fixturesRequest("DELETE"))).status).toBe(200);
    expect(await isDemo()).toBe(true);
    expect(e2eClaudeFixtureProvider(ctx.shop.id)).toBeNull();
  });

  it("refuses to turn a shop POST never armed into a demo", async () => {
    await ctx.db.update(shops).set({ isDemo: false }).where(eq(shops.id, ctx.shop.id));
    expect((await DELETE(fixturesRequest("DELETE"))).status).toBe(400);
    expect(await isDemo()).toBe(false);
  });

  it("refuses a second DELETE once the first has disarmed the shop", async () => {
    expect((await POST(fixturesRequest("POST"))).status).toBe(200);
    expect((await DELETE(fixturesRequest("DELETE"))).status).toBe(200);
    await ctx.db.update(shops).set({ isDemo: false }).where(eq(shops.id, ctx.shop.id));
    expect((await DELETE(fixturesRequest("DELETE"))).status).toBe(400);
    expect(await isDemo()).toBe(false);
  });
});
