import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationOauthStates, personRoles, shops } from "@/db/schema";
import { createIntegrationOAuthState, getShopIntegration } from "@/features/integrations";
import { nowMs } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import {
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

vi.mock("@/db/client", async (original) => ({
  ...(await original<typeof import("@/db/client")>()),
  getDb: vi.fn(),
}));
vi.mock("@/features/session", () => ({ requireStaffSession: vi.fn() }));
const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/features/session");
const { GET } = await import("./route");
const ctx = fileScopedShopContext({ realShop: true });
const callback = (query: string) =>
  new Request(`https://dive.day/api/integrations/square/callback?${query}`);
const fetchImpl = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubEnv("SQUARE_CLIENT_ID", "test-client");
  vi.stubEnv("SQUARE_CLIENT_SECRET", "test-secret");
  vi.stubEnv("SQUARE_ENVIRONMENT", "sandbox");
  vi.mocked(getDb).mockResolvedValue(ctx.db);
  fetchImpl.mockReset().mockImplementation(async () =>
    Response.json({
      access_token: "test-access",
      refresh_token: "test-refresh",
      expires_at: new Date(nowMs() + 3600000).toISOString(),
      merchant_id: "merchant-1",
    }),
  );
  vi.stubGlobal("fetch", fetchImpl);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
async function authorize(email = SEEDED_OWNER_EMAIL, environment = "sandbox") {
  const personId = await seededStaffPersonId(ctx.db, ctx.shop.id, email);
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: ctx.shop.id, shopSlug: ctx.shop.slug, personId }),
  );
  return createIntegrationOAuthState(ctx.db, {
    shopId: ctx.shop.id,
    personId,
    provider: "square",
    context: { environment },
  });
}
describe("Square callback", () => {
  it("binds credentials to the signed-in shop and consumes the state once", async () => {
    const state = await authorize();
    expect(
      (await GET(callback(`state=${state}&code=test-code`))).headers.get("location"),
    ).toContain("notice=connected");
    const row = await getShopIntegration(ctx.db, ctx.shop.id, "square");
    expect(row).toMatchObject({
      externalAccountId: "merchant-1",
      settings: { environment: "sandbox", eventTypes: [] },
    });
    expect(row?.credentialsSealed).not.toContain("test-access");
    expect(
      (await GET(callback(`state=${state}&code=test-code`))).headers.get("location"),
    ).toContain("notice=failed");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("rejects environment drift and cancellation without exchanging a code", async () => {
    const state = await authorize(SEEDED_OWNER_EMAIL, "production");
    expect(
      (await GET(callback(`state=${state}&code=test-code`))).headers.get("location"),
    ).toContain("notice=failed");
    const cancelState = await authorize();
    expect(
      (await GET(callback(`state=${cancelState}&error=access_denied`))).headers.get("location"),
    ).toContain("notice=failed");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("requires live manager permission and refuses demo connections", async () => {
    const state = await authorize(SEEDED_CAPTAIN_EMAIL);
    expect(
      (await GET(callback(`state=${state}&code=test-code`))).headers.get("location"),
    ).toContain("notice=not-authorized");
    const ownerState = await authorize();
    await ctx.db.update(shops).set({ isDemo: true }).where(eq(shops.id, ctx.shop.id));
    expect(
      (await GET(callback(`state=${ownerState}&code=test-code`))).headers.get("location"),
    ).toContain("notice=failed");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("does not let a different signed-in person spend the initiating owner’s state", async () => {
    const state = await authorize();
    const stranger = await seededStaffPersonId(ctx.db, ctx.shop.id, SEEDED_CAPTAIN_EMAIL);
    // A second real manager still cannot spend the initiating person’s state.
    await ctx.db.insert(personRoles).values({ personId: stranger, role: "manager" });
    vi.mocked(requireStaffSession).mockResolvedValue(
      staffSession({
        shopId: ctx.shop.id,
        shopSlug: ctx.shop.slug,
        personId: stranger,
        roles: ["manager"],
      }),
    );
    expect(
      (await GET(callback(`state=${state}&code=test-code`))).headers.get("location"),
    ).toContain("notice=failed");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

it("rejects expired state without contacting Square", async () => {
  const state = await authorize();
  await ctx.db.update(integrationOauthStates).set({ expiresAt: new Date(nowMs() - 1000) });
  expect((await GET(callback(`state=${state}&code=test-code`))).headers.get("location")).toContain(
    "notice=failed",
  );
  expect(fetchImpl).not.toHaveBeenCalled();
});
