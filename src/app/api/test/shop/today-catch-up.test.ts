import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activityEvents, people, personRoles, shops } from "@/db/schema";
import { createDemoShop } from "@/db/seed";
import { getShopBySlug } from "@/db/shops";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { readTodayCatchUp } from "../../../../features/today-catch-up/store";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});

const { getDb } = await import("@/db/client");
const { POST } = await import("./route");
const secret = "e2e-test-secret";

/** The door, asked for `todayCatchUp` on the shop `slug` names (none is the canonical demo). */
function seedRequest(slug?: string, authorization = `Bearer ${secret}`) {
  return new Request("http://localhost/api/test/shop", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ ...(slug ? { slug } : {}), facts: ["todayCatchUp"] }),
  });
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("DIVEDAY_E2E", "1");
  vi.stubEnv("DIVEDAY_E2E_SECRET", secret);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the todayCatchUp fact", () => {
  it("requires the E2E bearer secret and refuses a real database", async () => {
    expect((await POST(seedRequest(undefined, "Bearer wrong"))).status).toBe(404);

    vi.stubEnv("DATABASE_URL", "postgres://configured.example/db");
    expect((await POST(seedRequest())).status).toBe(404);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("refuses the shared demo shop, missing shops, and a non-demo tenant", async () => {
    const { db } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);

    expect((await POST(seedRequest())).status).toBe(404);
    expect((await POST(seedRequest("missing-shop"))).status).toBe(404);

    const minted = await createDemoShop(db, { shape: "lean", slug: "today-catch-up-not-demo" });
    const nonDemo = await getShopBySlug(db, minted.slug);
    if (!nonDemo) throw new Error("created private demo fixture was not found");
    await db.update(shops).set({ isDemo: false }).where(eq(shops.id, nonDemo.id));
    expect((await POST(seedRequest(minted.slug))).status).toBe(404);
  });

  it("writes a same-shop event after the reader baseline and leaves the shared demo untouched", async () => {
    const { db, shop: canonical } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);
    const minted = await createDemoShop(db, { shape: "lean", slug: "today-catch-up-private" });
    const privateShop = await getShopBySlug(db, minted.slug);
    if (!privateShop) throw new Error("created private demo fixture was not found");

    const response = await POST(seedRequest(minted.slug));
    expect(response.status).toBe(200);
    const fixture = (await response.json()).values.todayCatchUp as {
      personName: string;
      tripTitle: string;
    };
    expect(fixture.personName).toBeTruthy();
    expect(fixture.tripTitle).toBeTruthy();

    const owner = await db
      .select({ id: people.id })
      .from(personRoles)
      .innerJoin(people, eq(people.id, personRoles.personId))
      .where(and(eq(people.shopId, privateShop.id), eq(personRoles.role, "owner")))
      .limit(1)
      .then((rows) => rows[0]);
    if (!owner) throw new Error("private shop has no owner");
    const seen = await readTodayCatchUp(db, {
      shopId: privateShop.id,
      personId: owner.id,
      now: nowDate(),
      timeZone: privateShop.timezone,
    });
    expect(seen.mark).not.toBeNull();
    expect(seen.events).toHaveLength(1);
    expect(seen.events[0]).toMatchObject({ kind: "seat_taken", tripTitle: fixture.tripTitle });

    const privateRows = await db
      .select({ id: activityEvents.id })
      .from(activityEvents)
      .where(and(eq(activityEvents.shopId, privateShop.id), eq(activityEvents.code, "seat_added")));
    const canonicalRows = await db
      .select({ id: activityEvents.id })
      .from(activityEvents)
      .where(and(eq(activityEvents.shopId, canonical.id), eq(activityEvents.code, "seat_added")));
    expect(privateRows).toHaveLength(1);
    expect(canonicalRows).toHaveLength(0);
  });
});
