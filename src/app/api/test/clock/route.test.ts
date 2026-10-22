import { and, eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { trips } from "@/db/schema";
import { AT_SEA_DAY_TITLE, AT_SEA_DUSK_TITLE } from "@/db/seed-boat-at-sea";
import { listRollCallGaps } from "@/db/today";
import { DEPARTURE_BUFFER_MS } from "@/lib/trips";
import { fileScopedShopContext } from "@/test/db";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});

const { getDb } = await import("@/db/client");
const { GET, POST } = await import("./route");

/** One seeded demo database for the file, seeded at the fleet's frozen 9:30 AM. */
const seeded = fileScopedShopContext({ history: true });

const secret = "e2e-test-secret";

function clockRequest(method: "GET" | "POST", body?: unknown, authorization?: string) {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers.authorization = authorization;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request("http://localhost/api/test/clock", {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const authorized = `Bearer ${secret}`;

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("DIVEDAY_E2E_SECRET", secret);
  vi.stubEnv("DIVEDAY_CLOCK", "2026-07-21T10:00:00.000Z");
  vi.mocked(getDb).mockResolvedValue(seeded.db as AppDb);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/api/test/clock — auth gate", () => {
  it("404s without the bearer token, on both verbs", async () => {
    expect((await GET(clockRequest("GET"))).status).toBe(404);
    expect((await POST(clockRequest("POST", { now: "2026-07-21T11:00:00Z" }))).status).toBe(404);
    // The refusal left the clock where it was.
    expect(process.env.DIVEDAY_CLOCK).toBe("2026-07-21T10:00:00.000Z");
  });

  it("404s with the wrong bearer token", async () => {
    const response = await POST(
      clockRequest("POST", { now: "2026-07-21T11:00:00Z" }, "Bearer wrong-secret"),
    );
    expect(response.status).toBe(404);
    expect(process.env.DIVEDAY_CLOCK).toBe("2026-07-21T10:00:00.000Z");
  });

  it("404s whenever a real database is configured, whatever the token", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://real");
    const response = await POST(clockRequest("POST", { now: "2026-07-21T11:00:00Z" }, authorized));
    expect(response.status).toBe(404);
  });
});

describe("/api/test/clock — moving the frozen clock", () => {
  it("reads the frozen instant back", async () => {
    const response = await GET(clockRequest("GET", undefined, authorized));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ now: "2026-07-21T10:00:00.000Z" });
  });

  it("advances the clock and reports the new instant", async () => {
    const response = await POST(clockRequest("POST", { now: "2026-07-21T15:00:00Z" }, authorized));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ now: "2026-07-21T15:00:00.000Z" });
    expect(process.env.DIVEDAY_CLOCK).toBe("2026-07-21T15:00:00.000Z");
  });

  it("refuses a step backwards", async () => {
    const response = await POST(clockRequest("POST", { now: "2026-07-21T09:00:00Z" }, authorized));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "clock_would_move_backwards" });
    expect(process.env.DIVEDAY_CLOCK).toBe("2026-07-21T10:00:00.000Z");
  });

  it("refuses a body that is not an instant", async () => {
    for (const body of [{ now: "yesterday" }, { now: 42 }, {}, undefined]) {
      const response = await POST(clockRequest("POST", body, authorized));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_body" });
    }
    expect(process.env.DIVEDAY_CLOCK).toBe("2026-07-21T10:00:00.000Z");
  });
});

/**
 * **A clock moved past the boat at sea brings her home** (visual triage of
 * PR #2918, item 1a). The one-day simulation steps the clock through the
 * afternoon; the seed's boat at sea, due back at 10:00 with dive 2's count
 * open, would otherwise read "back with dive 2 uncounted" from then on.
 */
describe("/api/test/clock — the boat at sea", () => {
  it("leaves her at sea while she is out, and brings her home once the clock passes her", async () => {
    vi.stubEnv("DIVEDAY_CLOCK", "2026-07-21T13:30:00.000Z");
    const { db, shop } = seeded;
    const [atSea] = await db
      .select({ id: trips.id, endsAt: trips.endsAt })
      .from(trips)
      .where(
        and(eq(trips.shopId, shop.id), inArray(trips.title, [AT_SEA_DAY_TITLE, AT_SEA_DUSK_TITLE])),
      );
    if (!atSea) throw new Error("expected the seed's boat at sea under the frozen clock");

    const stillOut = new Date(atSea.endsAt.getTime() - 60_000);
    await POST(clockRequest("POST", { now: stillOut.toISOString() }, authorized));
    const openAtSea = await listRollCallGaps(db, shop.id, stillOut, [atSea.id]);
    expect(openAtSea.map((gap) => [gap.reason, gap.underway])).toContainEqual([
      "after_dive_uncounted",
      true,
    ]);

    const home = new Date(atSea.endsAt.getTime() + DEPARTURE_BUFFER_MS + 60 * 60_000);
    const response = await POST(clockRequest("POST", { now: home.toISOString() }, authorized));
    expect(response.status).toBe(200);
    expect(await listRollCallGaps(db, shop.id, home, [atSea.id])).toEqual([]);
  });
});
