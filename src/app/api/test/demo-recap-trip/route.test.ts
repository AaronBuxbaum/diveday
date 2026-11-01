import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { bookings, shops, trips } from "@/db/schema";
import { DEMO_RECAP_BOOKING_ID } from "@/db/seed-identifiers";
import { fileScopedShopContext } from "@/test/db";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});

const { getDb } = await import("@/db/client");
const { GET } = await import("./route");

const seeded = fileScopedShopContext();
const secret = "e2e-test-secret";
const authorized = `Bearer ${secret}`;

function request(authorization?: string) {
  return new Request("http://localhost/api/test/demo-recap-trip", {
    headers: authorization === undefined ? {} : { authorization },
  });
}

async function createRivalShop(db: AppDb) {
  const [rival] = await db
    .insert(shops)
    .values({ name: "Rival Reef", slug: "recap-trip-lookup-rival", timezone: "America/New_York" })
    .returning({ id: shops.id });
  if (!rival) throw new Error("rival shop insert failed");
  return rival;
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("DIVEDAY_E2E_SECRET", secret);
  vi.mocked(getDb).mockResolvedValue(seeded.db as AppDb);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/test/demo-recap-trip", () => {
  it("returns only the demo recap booking's shop-scoped trip id", async () => {
    const [booking] = await seeded.db
      .select({ tripId: bookings.tripId })
      .from(bookings)
      .where(eq(bookings.id, DEMO_RECAP_BOOKING_ID))
      .limit(1);
    if (!booking) throw new Error("demo recap booking is missing");

    const response = await GET(request(authorized));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tripId: booking.tripId });
  });

  it("does not return a booking assigned to another shop", async () => {
    const rival = await createRivalShop(seeded.db);
    // The composite key now refuses this row, so lift it for this transaction to probe the read.
    await seeded.db.execute(sql`set local session_replication_role = replica`);
    await seeded.db
      .update(bookings)
      .set({ shopId: rival.id })
      .where(eq(bookings.id, DEMO_RECAP_BOOKING_ID));

    const response = await GET(request(authorized));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "booking_not_found" });
  });

  it("does not return a trip assigned to another shop", async () => {
    const [booking] = await seeded.db
      .select({ tripId: bookings.tripId })
      .from(bookings)
      .where(eq(bookings.id, DEMO_RECAP_BOOKING_ID))
      .limit(1);
    if (!booking) throw new Error("demo recap booking is missing");
    const rival = await createRivalShop(seeded.db);
    // The composite key now refuses this row, so lift it for this transaction to probe the read.
    await seeded.db.execute(sql`set local session_replication_role = replica`);
    await seeded.db.update(trips).set({ shopId: rival.id }).where(eq(trips.id, booking.tripId));

    const response = await GET(request(authorized));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "booking_not_found" });
  });

  it("refuses when the canonical shop is no longer a demo", async () => {
    await seeded.db.update(shops).set({ isDemo: false }).where(eq(shops.id, seeded.shop.id));

    const response = await GET(request(authorized));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_demo" });
  });
});
