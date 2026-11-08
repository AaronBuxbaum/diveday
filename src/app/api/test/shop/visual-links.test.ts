import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ownerLogins } from "@/db/owner-logins";
import { shops } from "@/db/schema";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import {
  checkBookkeeperConfirmation,
  isBookkeeperToken,
  resolveBookkeeperStopToken,
} from "../../../../features/bookkeeper/store";
import {
  checkShoreAlertConfirmation,
  isShoreAlertToken,
  resolveShoreAlertStopToken,
} from "../../../../features/shore-alert-tokens/store";
import { resolveWeeklyDigestUnsubscribeToken } from "../../../../features/weekly-digest/store";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});

const { getDb } = await import("@/db/client");
const { POST } = await import("./route");
const ctx = fileScopedShopContext();
const secret = "e2e-visual-links-secret";
const slug = "visual-links-private";

/** The door, asked for `visualLink` with these arguments on the shop `shopSlug` names. */
function seedRequest(
  { shopSlug, ...args }: { shopSlug: string } & Record<string, unknown>,
  authorization = `Bearer ${secret}`,
) {
  return new Request("http://localhost/api/test/shop", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ slug: shopSlug, facts: [{ name: "visualLink", ...args }] }),
  });
}

async function seed(family: string, state = "active"): Promise<string> {
  const response = await POST(seedRequest({ shopSlug: slug, family, state }));
  expect(response.status).toBe(200);
  const result = (await response.json()).values.visualLink;
  expect(result.path).toBe(
    `${family.endsWith("-confirm") ? "/confirm-contact" : "/unsubscribe"}/${result.token}`,
  );
  if (typeof result.token !== "string") throw new Error("Visual fixture returned no token");
  return result.token;
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("DIVEDAY_E2E_SECRET", secret);
  vi.mocked(getDb).mockResolvedValue(ctx.db);
  // The test's database is isolated already; give its demo the identity the
  // fact requires instead of minting a second full seeded tenant per case.
  await ctx.db.update(shops).set({ slug }).where(eq(shops.id, ctx.shop.id));
});

afterEach(() => vi.unstubAllEnvs());

describe("the visualLink fact", () => {
  it("refuses before reading the database when the harness bearer is wrong", async () => {
    const response = await POST(seedRequest({ shopSlug: slug, family: "digest" }, "Bearer wrong"));
    expect(response.status).toBe(404);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("refuses invalid family/state pairs before the database", async () => {
    for (const body of [
      { shopSlug: slug, family: "digest", state: "expired" },
      { shopSlug: slug, family: "shore-stop", state: "expired" },
      { shopSlug: slug, family: "unknown" },
      { shopSlug: "../elsewhere", family: "digest" },
      { shopSlug: slug, family: "digest", personId: "caller-controlled" },
    ]) {
      const response = await POST(seedRequest(body));
      expect(response.status).toBe(400);
    }
    expect(getDb).not.toHaveBeenCalled();
  });

  it("refuses the shared fixture: a private shop's fact", async () => {
    await ctx.db.update(shops).set({ slug: "blue-mantis" }).where(eq(shops.id, ctx.shop.id));
    const response = await POST(seedRequest({ shopSlug: "blue-mantis", family: "digest" }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_available" });
  });

  it("refuses missing and real tenants without changing their contact settings", async () => {
    const missing = await POST(seedRequest({ shopSlug: "missing-shop", family: "shore-confirm" }));
    expect(missing.status).toBe(404);
    await ctx.db.update(shops).set({ isDemo: false }).where(eq(shops.id, ctx.shop.id));
    const response = await POST(seedRequest({ shopSlug: slug, family: "shore-confirm" }));
    expect(response.status).toBe(404);
    const [shop] = await ctx.db.select().from(shops).where(eq(shops.id, ctx.shop.id));
    expect(shop?.shoreAlertEmail).toBe(ctx.shop.shoreAlertEmail);
  });

  it("mints a live shore confirmation the real page resolver accepts", async () => {
    const token = await seed("shore-confirm");
    expect(await checkShoreAlertConfirmation(ctx.db, { token })).toMatchObject({
      shopId: ctx.shop.id,
      email: "shore.audit@example.com",
    });
  });

  it("mints a live bookkeeper confirmation the real page resolver accepts", async () => {
    const token = await seed("bookkeeper-confirm");
    expect(await checkBookkeeperConfirmation(ctx.db, { token, now: nowDate() })).toEqual({
      shopName: ctx.shop.name,
      email: "books.audit@example.com",
    });
  });

  it("mints a shore stop link whose confirmed address is still current", async () => {
    const token = await seed("shore-stop");
    expect(await resolveShoreAlertStopToken(ctx.db, token)).toEqual({
      shopId: ctx.shop.id,
      shopName: ctx.shop.name,
      alreadyStopped: false,
    });
  });

  it("mints a real confirmed bookkeeper's month-end stop link", async () => {
    const token = await seed("bookkeeper-stop");
    expect(await resolveBookkeeperStopToken(ctx.db, token)).toEqual({
      shopName: ctx.shop.name,
      alreadyStopped: false,
    });
  });

  it("ties the digest claim to this tenant's active owner and refuses a duplicate seed", async () => {
    const token = await seed("digest");
    const [owner] = await ownerLogins(ctx.db, ctx.shop.id);
    expect(owner).toBeDefined();
    expect(await resolveWeeklyDigestUnsubscribeToken(ctx.db, token)).toEqual({
      shopName: ctx.shop.name,
      personId: owner?.personId,
      alreadyOff: false,
    });
    const duplicate = await POST(seedRequest({ shopSlug: slug, family: "digest" }));
    expect(duplicate.status).toBe(409);
    expect(await resolveWeeklyDigestUnsubscribeToken(ctx.db, token)).not.toBeNull();
  });

  it("keeps expired confirmation links recognizable without making them usable", async () => {
    const shore = await seed("shore-confirm", "expired");
    expect(await isShoreAlertToken(ctx.db, { token: shore })).toBe(true);
    expect(await checkShoreAlertConfirmation(ctx.db, { token: shore })).toBeNull();
    const books = await seed("bookkeeper-confirm", "expired");
    expect(await isBookkeeperToken(ctx.db, { token: books })).toBe(true);
    expect(await checkBookkeeperConfirmation(ctx.db, { token: books, now: nowDate() })).toBeNull();
  });
});
