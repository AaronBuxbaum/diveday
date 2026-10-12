import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDiver } from "@/db/divers";
import { people, shops } from "@/db/schema";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";

/**
 * The merge preview's capture prints two records' "Added" dates, and both
 * read the database's wall clock until this route pins them (issue #2297).
 */

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});

const { getDb } = await import("@/db/client");
const { POST } = await import("./route");

const secret = "e2e-test-secret";

function pinRequest(body: unknown) {
  return new Request("http://localhost/api/test/pin-added-date", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("DIVEDAY_E2E_SECRET", secret);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/test/pin-added-date", () => {
  it("stamps every live record of the name with the app's clock, and no one else", async () => {
    const { db, shop } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);
    await createDiver(db, {
      shopId: shop.id,
      fullName: "Priya Sharma",
      email: "priya.duplicate@example.com",
    });

    const response = await POST(pinRequest({ fullName: "Priya Sharma" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ pinned: 2 });

    const priyas = await db
      .select({ created: people.createdAt })
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Priya Sharma")));
    expect(priyas.map((row) => row.created.getTime())).toEqual([
      nowDate().getTime(),
      nowDate().getTime(),
    ]);
    const [tom] = await db
      .select({ created: people.createdAt })
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Tom Okafor")));
    expect(tom?.created.getTime()).not.toBe(nowDate().getTime());
  }, 60_000);

  it("refuses a shop that is not the demo, and pins nothing", async () => {
    const { db, shop } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);
    await db.update(shops).set({ isDemo: false }).where(eq(shops.id, shop.id));

    const response = await POST(pinRequest({ fullName: "Priya Sharma" }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_available" });

    const [priya] = await db
      .select({ created: people.createdAt })
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Priya Sharma")));
    expect(priya?.created.getTime()).not.toBe(nowDate().getTime());
  }, 60_000);

  it("refuses a name longer than any person's", async () => {
    const response = await POST(pinRequest({ fullName: "x".repeat(201) }));
    expect(response.status).toBe(400);
  });
});
