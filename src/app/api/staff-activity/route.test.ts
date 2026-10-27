import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accountSessions, people, userAccounts } from "@/db/schema";
import type { DiveDaySession } from "@/lib/auth";
import { nowDate } from "@/lib/clock";
import { STAFF_IDLE_LIMIT_MS } from "@/lib/session-idle";
import { fileScopedShopContext } from "@/test/db";

const ctx = fileScopedShopContext();
vi.mock("@/db/client", async (original) => ({
  ...(await original<typeof import("@/db/client")>()),
  getDb: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<DiveDaySession | null>>() }));
const { getDb } = await import("@/db/client");
const { auth } = await import("@/lib/auth");
const { GET, POST } = await import("./route");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDb).mockResolvedValue(ctx.db);
});
const request = (origin = "https://diveday.example", sessionId = "") =>
  new Request("https://diveday.example/api/staff-activity", {
    method: "POST",
    headers: { origin, host: "diveday.example", "x-staff-session": sessionId },
  });

async function signedIn() {
  const { db, shop } = ctx;
  const [account] = await db
    .select({ id: userAccounts.id, personId: people.id })
    .from(userAccounts)
    .innerJoin(people, eq(people.id, userAccounts.personId))
    .where(eq(people.shopId, shop.id))
    .limit(1);
  if (!account) throw new Error("staff account missing");
  const [row] = await db
    .insert(accountSessions)
    .values({
      userAccountId: account.id,
      personId: account.personId,
      shopId: shop.id,
      shopSlug: shop.slug,
      roles: ["owner"],
      name: "Staff",
      token: crypto.randomUUID(),
      expiresAt: new Date(nowDate().getTime() + STAFF_IDLE_LIMIT_MS),
      lastHumanActivityAt: new Date(nowDate().getTime() - 1000),
    })
    .returning();
  if (!row) throw new Error("session missing");
  vi.mocked(auth).mockResolvedValue({
    user: {
      userAccountId: account.id,
      sessionId: row.id,
      personId: account.personId,
      shopId: shop.id,
      shopSlug: shop.slug,
      name: "Staff",
      email: "staff@example.test",
      roles: ["owner"],
    },
  });
  return row;
}

describe("staff activity endpoint", () => {
  it("refuses cross-site requests before reading the session", async () => {
    expect((await POST(request("https://attacker.example"))).status).toBe(403);
    expect(auth).not.toHaveBeenCalled();
  });
  it("accepts the public host when the runtime's internal request URL differs", async () => {
    const row = await signedIn();
    const behindProxy = new Request("http://localhost:29472/api/staff-activity", {
      method: "POST",
      headers: {
        host: "127.0.0.1:29472",
        origin: "http://127.0.0.1:29472",
        "x-staff-session": row.id,
      },
    });
    expect((await POST(behindProxy)).status).toBe(204);
  });
  it("requires an authenticated live staff member and an active session", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
    const row = await signedIn();
    expect((await POST(request("https://diveday.example", "another-session"))).status).toBe(401);
    expect((await POST(request("https://diveday.example", row.id))).status).toBe(204);
    await ctx.db.delete(accountSessions).where(eq(accountSessions.id, row.id));
    expect((await POST(request("https://diveday.example", row.id))).status).toBe(401);
  });
  it("checks the session without recording activity and refuses another session", async () => {
    const row = await signedIn();
    const session = await vi.mocked(auth)();
    if (!session) throw new Error("session missing");
    vi.mocked(auth).mockResolvedValue({ ...session, idleRemainingMs: 1234 });
    expect((await GET(request("https://diveday.example", "other"))).status).toBe(401);
    const response = await GET(request("https://diveday.example", row.id));
    expect(await response.json()).toEqual({ remainingMs: 1234 });
    expect(response.headers.get("cache-control")).toBe("no-store");
    const [after] = await ctx.db
      .select()
      .from(accountSessions)
      .where(eq(accountSessions.id, row.id));
    expect(after?.lastHumanActivityAt).toEqual(row.lastHumanActivityAt);
  });
  it("does not uncover a hidden tab after its account is disabled", async () => {
    const row = await signedIn();
    const session = await vi.mocked(auth)();
    if (!session) throw new Error("session missing");
    vi.mocked(auth).mockResolvedValue({ ...session, idleRemainingMs: 1234 });
    await ctx.db
      .update(userAccounts)
      .set({ status: "disabled" })
      .where(eq(userAccounts.id, row.userAccountId));
    expect((await GET(request("https://diveday.example", row.id))).status).toBe(401);
  });
});
