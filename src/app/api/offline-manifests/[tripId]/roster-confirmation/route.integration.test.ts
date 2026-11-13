import { eq } from "drizzle-orm";
import { beforeEach, expect, it, vi } from "vitest";
import { personRoles, shops } from "@/db/schema";
import { signRosterConfirmation } from "@/features/offline-manifest-snapshots";
import type { DiveDaySession } from "@/lib/auth";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_CAPTAIN_EMAIL, seededStaffPersonId } from "@/test/staff-session";

const ctx = fileScopedShopContext();
vi.mock("@/db/client", async (original) => ({
  ...(await original<typeof import("@/db/client")>()),
  getDb: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<DiveDaySession | null>>() }));
const { getDb } = await import("@/db/client");
const { auth } = await import("@/lib/auth");
const { POST } = await import("./route");
const tripId = "11111111-1111-4111-8111-111111111111";
const nonce = "22222222-2222-4222-8222-222222222222";
const renderId = "33333333-3333-4333-8333-333333333333";
const readCompletedAt = 1_794_581_040_000;
const params = Promise.resolve({ tripId });
const request = (proof: string | null) =>
  new Request("http://localhost/confirmation", {
    method: "POST",
    body: JSON.stringify({ nonce, renderId, proof, checkpoint: "departure", readCompletedAt }),
  });

beforeEach(() => {
  vi.mocked(getDb).mockReset();
  vi.mocked(auth).mockReset();
});

it("refuses an old roster after same-shop session replacement, signout, or staff-role removal", async () => {
  const { db, shop } = ctx;
  const personId = await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL);
  const session: DiveDaySession = {
    user: {
      personId,
      sessionId: "old-session",
      shopId: shop.id,
      shopSlug: shop.slug,
      name: "Captain",
      email: "captain@example.com",
      roles: ["captain"],
    },
  };
  const proof = signRosterConfirmation({
    shopId: shop.id,
    tripId,
    sessionId: "old-session",
    nonce,
    renderId,
    erasureEpoch: shop.offlineErasureEpoch,
    checkpoint: "departure",
    readCompletedAt,
  });
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(auth).mockResolvedValue(session);
  expect((await POST(request(proof), { params })).status).toBe(204);
  vi.mocked(auth).mockResolvedValue({
    ...session,
    user: { ...session.user, sessionId: "replacement-session" },
  });
  expect((await POST(request(proof), { params })).status).toBe(403);
  vi.mocked(auth).mockResolvedValue(null);
  expect((await POST(request(proof), { params })).status).toBe(401);
  vi.mocked(auth).mockResolvedValue(session);
  await db
    .update(shops)
    .set({ offlineErasureEpoch: shop.offlineErasureEpoch + 1 })
    .where(eq(shops.id, shop.id));
  expect((await POST(request(proof), { params })).status).toBe(403);
  await db.delete(personRoles).where(eq(personRoles.personId, personId));
  expect((await POST(request(proof), { params })).status).toBe(401);
});
