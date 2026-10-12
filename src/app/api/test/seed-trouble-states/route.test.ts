import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listOwedShopCancellationRefunds } from "@/db/refunds";
import { trips } from "@/db/schema";
import { seededShopContext } from "@/test/db";

/**
 * **A trouble state lands only on the caller who asked for it** (issue #2338).
 *
 * The owed-refund state cancels a departure that carries a paid seat, which in
 * the demo is an upcoming departure every other spec and capture may expect to
 * be on the board. It ran on every call, whatever flags the caller passed, so a
 * spec that seeded `?boatSafety=1` also lost that departure and a capture's
 * picture depended on which spec had seeded first. It is opt-in now, like the
 * other states that move what unrelated pages read.
 */

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});

const { getDb } = await import("@/db/client");
const { POST } = await import("./route");

const secret = "e2e-test-secret";

function seedRequest(query = "") {
  return new Request(`http://localhost/api/test/seed-trouble-states${query}`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });
}

async function cancelledTripIds(db: Awaited<ReturnType<typeof seededShopContext>>["db"]) {
  const rows = await db.select({ id: trips.id }).from(trips).where(eq(trips.status, "cancelled"));
  return rows.map((row) => row.id).sort();
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("DIVEDAY_E2E_SECRET", secret);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/test/seed-trouble-states", () => {
  it("cancels no departure for a caller who asked for another state", async () => {
    const { db, shop } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);
    const before = await cancelledTripIds(db);

    const response = await POST(seedRequest("?boatSafety=1"));
    expect(response.status).toBe(200);

    expect(await cancelledTripIds(db)).toEqual(before);
    expect(await listOwedShopCancellationRefunds(db, shop.id)).toEqual([]);
  }, 60_000);

  it("owes a refund on a cancelled departure when the caller asks for it", async () => {
    const { db, shop } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);

    const response = await POST(seedRequest("?owedRefund=1"));
    expect(response.status).toBe(200);

    expect((await listOwedShopCancellationRefunds(db, shop.id)).length).toBeGreaterThan(0);
  }, 60_000);
});
