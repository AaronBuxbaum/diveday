import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { shops, trips } from "@/db/schema";
import {
  assignedPublicStaffProfiles,
  listPublicStaffProfiles,
} from "@/features/public-staff-profiles";
import { fileScopedShopContext } from "@/test/db";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
const { getDb } = await import("@/db/client");
const { POST } = await import("./route");
const ctx = fileScopedShopContext();
beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("DIVEDAY_E2E_SECRET", "profile-fact-secret");
  vi.mocked(getDb).mockResolvedValue(ctx.db);
});
afterEach(() => vi.unstubAllEnvs());
const request = (slug: string) =>
  new Request("http://localhost/api/test/shop", {
    method: "POST",
    headers: { authorization: "Bearer profile-fact-secret", "content-type": "application/json" },
    body: JSON.stringify({ slug, facts: ["publicStaffProfile"] }),
  });
it("refuses the private profile fact on the shared demo without publishing anyone", async () => {
  expect((await POST(request(ctx.shop.slug))).status).toBe(404);
  expect(await listPublicStaffProfiles(ctx.db, ctx.shop.id)).toEqual([]);
});
it("publishes explicit fictional content from an available assigned instructor in a private shop", async () => {
  const slug = "private-public-profile-fixture";
  await ctx.db.update(shops).set({ slug }).where(eq(shops.id, ctx.shop.id));
  const response = await POST(request(slug));
  expect(response.status).toBe(200);
  const { values } = await response.json();
  const fact = values.publicStaffProfile as {
    tripId: string;
    courseSlug: string;
    firstName: string;
    description: string;
  };
  expect(fact.courseSlug).toBeTruthy();
  const [trip] = await ctx.db.select().from(trips).where(eq(trips.id, fact.tripId));
  if (!trip) throw new Error("fixture trip missing");
  expect(await listPublicStaffProfiles(ctx.db, ctx.shop.id)).toEqual([
    expect.objectContaining({ description: fact.description, photoUrls: [] }),
  ]);
  expect(
    await assignedPublicStaffProfiles(ctx.db, ctx.shop.id, [trip], ctx.shop.timezone, true),
  ).toEqual([expect.objectContaining({ firstName: fact.firstName })]);
});
