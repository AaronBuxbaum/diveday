import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shops } from "@/db/schema";
import { fileScopedShopContext } from "@/test/db";
import { e2eClaudeFixtureProvider } from "../../../../features/assists/e2e-fixtures";

const ctx = fileScopedShopContext();

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});

const { getDb } = await import("@/db/client");
const { DELETE, POST } = await import("./route");

const secret = "e2e-test-secret";
const slug = "claude-fixtures-minted";

function arm() {
  return new Request("http://localhost/api/test/shop", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify({ slug, facts: ["claudeAssists"] }),
  });
}

function teardown() {
  return new Request(`http://localhost/api/test/shop?slug=${slug}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${secret}` },
  });
}

async function row() {
  const [found] = await ctx.db
    .select({ isDemo: shops.isDemo })
    .from(shops)
    .where(eq(shops.id, ctx.shop.id));
  return found;
}

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("DIVEDAY_E2E", "1");
  vi.stubEnv("DIVEDAY_E2E_SECRET", secret);
  vi.mocked(getDb).mockResolvedValue(ctx.db);
  // The seeded shop is the canonical fixture the fact refuses; give it a minted slug.
  await ctx.db.update(shops).set({ slug, isDemo: true }).where(eq(shops.id, ctx.shop.id));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the claudeAssists fact", () => {
  it("arms a minted demo, and the teardown disarms it and drops it", async () => {
    expect((await POST(arm())).status).toBe(200);
    expect((await row())?.isDemo).toBe(false);
    expect(e2eClaudeFixtureProvider(ctx.shop.id)).not.toBeNull();

    const dropped = await DELETE(teardown());
    expect(await dropped.json()).toEqual({ ok: true, dropped: true });
    expect(e2eClaudeFixtureProvider(ctx.shop.id)).toBeNull();
    expect(await row()).toBeUndefined();
  });

  it("leaves a real shop it never armed where it is", async () => {
    await ctx.db.update(shops).set({ isDemo: false }).where(eq(shops.id, ctx.shop.id));
    const kept = await DELETE(teardown());
    expect(await kept.json()).toEqual({ ok: true, dropped: false });
    expect((await row())?.isDemo).toBe(false);
  });

  it("refuses the canonical fixture, which every spec shares", async () => {
    await ctx.db.update(shops).set({ slug: "blue-mantis" }).where(eq(shops.id, ctx.shop.id));
    const response = await POST(
      new Request("http://localhost/api/test/shop", {
        method: "POST",
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
        body: JSON.stringify({ facts: ["claudeAssists"] }),
      }),
    );
    expect(response.status).toBe(404);
    expect(e2eClaudeFixtureProvider(ctx.shop.id)).toBeNull();
  });
});
