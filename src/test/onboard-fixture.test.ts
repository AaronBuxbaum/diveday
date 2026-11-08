import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { setupRequests, shops } from "@/db/schema";
import { issueSetupLink } from "@/features/setup-links";
import { createSignedUpShop } from "@/features/shop-signup";
import { DEFAULT_PRICING_CONFIG } from "@/lib/billing/pricing-plans";
import { unseededTestDb } from "./db";
import { dropOnboardFixture } from "./onboard-fixture";
import { mintASetupLink } from "./shop-facts/mint-tokens";

async function signup(
  db: Awaited<ReturnType<typeof unseededTestDb>>,
  slug: string,
  existingToken?: string,
) {
  const path = existingToken ? null : (await mintASetupLink(db)).path;
  const token = existingToken ?? new URL(path ?? "", "http://localhost").searchParams.get("setup");
  if (!token) throw new Error("fixture link has no token");
  const result = await createSignedUpShop(
    db,
    {
      setupToken: token,
      shopName: "Fresh Shop E2E",
      shopSlug: slug,
      timezone: "America/New_York",
      ownerName: "Nour Haddad",
      ownerEmail: `${slug}@example.com`,
      ownerPassword: "trial-pass-123",
      firstChecklistLine: "Oxygen is aboard",
    },
    DEFAULT_PRICING_CONFIG,
  );
  if (!result.ok) throw new Error(result.reason);
  return { token, shop: result.shop };
}

describe("onboarding capture teardown", () => {
  it("drops only the shop created by its test-owned setup link and permits the same slug again", async () => {
    const db = await unseededTestDb();
    const first = await signup(db, "today-empty-light");
    const other = await signup(db, "unrelated-fixture");
    expect(await dropOnboardFixture(db, "not-a-fixture-token")).toBe(false);
    expect(await db.select().from(shops).where(eq(shops.id, first.shop.id))).toHaveLength(1);
    expect(await dropOnboardFixture(db, first.token)).toBe(true);
    expect(await dropOnboardFixture(db, first.token)).toBe(false);
    const second = await signup(db, "today-empty-light");
    expect(second.shop.id).not.toBe(first.shop.id);
    expect(await dropOnboardFixture(db, second.token)).toBe(true);
    expect(await db.select().from(shops).where(eq(shops.id, other.shop.id))).toHaveLength(1);
    expect(await dropOnboardFixture(db, other.token)).toBe(true);
  });
  it("refuses a genuine signup link not minted by the test fact", async () => {
    const db = await unseededTestDb();
    const [request] = await db
      .insert(setupRequests)
      .values({
        shopName: "Real shop",
        region: "Florida",
        runsBoat: false,
        currentSystem: "other",
        contactName: "Nour Haddad",
        email: "real@example.com",
        source: "unknown",
        locale: "en-US",
      })
      .returning({ id: setupRequests.id });
    if (!request) throw new Error("missing setup request");
    const link = await issueSetupLink(db, { setupRequestId: request.id });
    const { shop } = await signup(db, "ordinary-real-shop", link.token);
    expect(await dropOnboardFixture(db, link.token)).toBe(false);
    expect(await db.select().from(shops).where(eq(shops.id, shop.id))).toHaveLength(1);
  });
});
