import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_SHOP_SLUG } from "@/db/demo-shop";
import { accountSignInChallenges, people, shops, userAccounts } from "@/db/schema";
import { nowMs } from "@/lib/clock";
import { APP_ORIGIN, publicAppUrl } from "@/lib/notifications/app-url";
import {
  createPendingHandle,
  hashPendingHandle,
  pendingCookie,
  signInOrigins,
} from "@/lib/pending-sign-in";
import { fileScopedShopContext } from "@/test/db";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
const { getDb } = await import("@/db/client");
const { POST } = await import("./route");
const ctx = fileScopedShopContext();

async function fixture() {
  const [shop] = await ctx.db
    .insert(shops)
    .values({
      name: "Private auth fixture",
      slug: "private-auth-fixture",
      timezone: "UTC",
      isDemo: true,
    })
    .returning();
  const [person] = await ctx.db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Auth fixture" })
    .returning();
  const [account] = await ctx.db
    .insert(userAccounts)
    .values({ personId: person.id, email: "auth@private-auth-fixture.demo.invalid" })
    .returning();
  const handle = createPendingHandle();
  const [challenge] = await ctx.db
    .insert(accountSignInChallenges)
    .values({
      shopId: shop.id,
      userAccountId: account.id,
      tokenHash: hashPendingHandle(handle),
      expiresAt: new Date(nowMs() + 300_000),
    })
    .returning();
  const cookie = pendingCookie(
    signInOrigins(publicAppUrl() ?? APP_ORIGIN, process.env)[0],
    process.env.DIVEDAY_E2E === "1",
  );
  const request = (slug = shop.slug, value = handle) =>
    new Request("https://dive.day/api/test/shop", {
      method: "POST",
      headers: {
        cookie: `${cookie.name}=${value}`,
        authorization: "Bearer auth-state-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({ slug, facts: ["authChallengeExpired"] }),
    });
  const row = async () =>
    (
      await ctx.db
        .select()
        .from(accountSignInChallenges)
        .where(eq(accountSignInChallenges.id, challenge.id))
    )[0];
  return { request, row, challenge };
}

describe("private pending challenge expiry fixture", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("DIVEDAY_E2E_SECRET", "auth-state-secret");
    vi.mocked(getDb).mockResolvedValue(ctx.db);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("expires only the presented private shop's pending handle", async () => {
    const h = await fixture();
    expect((await POST(h.request())).status).toBe(200);
    const row = await h.row();
    expect(row.expiresAt.getTime()).toBeLessThan(nowMs());
    expect(row.createdAt.getTime()).toBeLessThan(row.expiresAt.getTime());
    expect(row.tokenHash).toBe(h.challenge.tokenHash);
    expect(row.attemptsRemaining).toBe(5);
  });
  it("refuses canonical-demo, wrong-shop and tampered handles without changing expiry", async () => {
    const h = await fixture();
    for (const request of [
      h.request(DEMO_SHOP_SLUG),
      h.request("unknown-shop"),
      h.request(undefined, "A".repeat(43)),
    ]) {
      expect((await POST(request)).status).toBe(404);
      expect((await h.row()).expiresAt).toEqual(h.challenge.expiresAt);
    }
  });
});
