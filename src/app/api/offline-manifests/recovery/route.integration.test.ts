import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, expect, it, vi } from "vitest";
import { revokeAccountSession } from "@/db/account-security";
import { accountSessions, personRoles, shops, userAccounts } from "@/db/schema";
import { verifyLiveManifestRecovery } from "@/features/live-manifest-server";
import type { DiveDaySession } from "@/lib/auth";
import { authSecret } from "@/lib/auth-secret";
import { nowMs } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_CAPTAIN_EMAIL, seededStaffPersonId } from "@/test/staff-session";

const ctx = fileScopedShopContext();
vi.mock("@/db/client", async (original) => ({
  ...(await original<typeof import("@/db/client")>()),
  getDb: vi.fn(),
}));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  auth: vi.fn<() => Promise<DiveDaySession | null>>(),
}));
const { getDb } = await import("@/db/client");
const { auth } = await import("@/lib/auth");
const { createAuth, readSessionFrom } = await import("@/lib/auth");
const { POST } = await import("./route");
const challenge = {
  tombstone: "11111111-1111-4111-8111-111111111111",
  nonce: "22222222-2222-4222-8222-222222222222",
};
const request = () =>
  new Request("http://localhost/recovery", { method: "POST", body: JSON.stringify(challenge) });

beforeEach(() => {
  vi.mocked(getDb).mockReset();
  vi.mocked(auth).mockReset();
});

it("observes live shop epoch and staff role, with a different handle after session replacement", async () => {
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
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(auth).mockResolvedValue(session);
  const firstResponse = await POST(request());
  expect(firstResponse.status).toBe(200);
  const first = await firstResponse.json();
  expect(first.erasureEpoch).toBe(shop.offlineErasureEpoch);
  expect(verifyLiveManifestRecovery(first, first.proof, nowMs())).toBe(true);
  vi.mocked(auth).mockResolvedValue({
    ...session,
    user: { ...session.user, sessionId: "replacement-session" },
  });
  const second = await (await POST(request())).json();
  expect(second.sessionHandle).not.toBe(first.sessionHandle);
  expect(
    verifyLiveManifestRecovery(
      { ...first, sessionHandle: second.sessionHandle },
      first.proof,
      nowMs(),
    ),
  ).toBe(false);
  await db
    .update(shops)
    .set({ offlineErasureEpoch: shop.offlineErasureEpoch + 1 })
    .where(eq(shops.id, shop.id));
  const afterErasure = await (await POST(request())).json();
  expect(afterErasure.erasureEpoch).toBe(shop.offlineErasureEpoch + 1);
  expect(
    verifyLiveManifestRecovery(
      { ...first, erasureEpoch: afterErasure.erasureEpoch },
      first.proof,
      nowMs(),
    ),
  ).toBe(false);
  vi.mocked(auth).mockResolvedValue(null);
  expect((await POST(request())).status).toBe(401);
  vi.mocked(auth).mockResolvedValue(session);
  await db.delete(personRoles).where(eq(personRoles.personId, personId));
  expect((await POST(request())).status).toBe(401);
});

it("refuses a real signed session cookie after its database session is revoked", async () => {
  const { db, shop } = ctx;
  const personId = await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL);
  const [account] = await db
    .select()
    .from(userAccounts)
    .where(eq(userAccounts.personId, personId))
    .limit(1);
  if (!account) throw new Error("seeded captain has no account");
  const instance = createAuth(db);
  const context = await instance.$context;
  const session = await context.internalAdapter.createSession(account.id, false, {
    personId,
    shopId: shop.id,
    shopSlug: shop.slug,
    roles: ["captain"],
    name: "Captain",
  });
  if (!session) throw new Error("could not create session");
  await db
    .update(accountSessions)
    .set({ lastHumanActivityAt: new Date(session.expiresAt.getTime() - 7 * 24 * 60 * 60 * 1000) })
    .where(eq(accountSessions.id, session.id));
  const signature = createHmac("sha256", authSecret ?? "")
    .update(session.token)
    .digest("base64");
  const cookie = `${context.authCookies.sessionToken.name}=${encodeURIComponent(`${session.token}.${signature}`)}`;
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(auth).mockImplementation(() => readSessionFrom(instance, new Headers({ cookie })));
  expect((await POST(request())).status).toBe(200);
  expect(await revokeAccountSession(db, account.id, session.id)).toBe(true);
  expect((await POST(request())).status).toBe(401);
});
