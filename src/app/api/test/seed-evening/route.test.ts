import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDayCloseout } from "@/db/closeout";
import { assembleEveningClose } from "@/lib/closeout";
import { seededShopContext } from "@/test/db";

/**
 * **The one thing this route's `?heads=closed` exists for is a state nothing
 * else can reach.**
 *
 * `assembleEveningClose` spends the spine's single coral element on
 * `allHome` — every boat of the day back and every head count closed — and it
 * refuses to say it on arithmetic alone: each station's status has to be
 * `all_home`, because "10 out, 10 back" over a boat nobody counted is a claim
 * the shop's own records do not support. So the demo's evening could be
 * photographed for months without that element ever appearing, which is issue
 * #1122.
 *
 * The assertion worth having is therefore not "rows were written" but the
 * flag itself, read the way the page reads it. Both directions are pinned: the
 * plain evening must *not* claim it, or the parameter would be decorative and
 * the two captures would be the same picture.
 */

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});

const { getDb } = await import("@/db/client");
const { POST } = await import("./route");

const secret = "e2e-test-secret";

function seedRequest(query = "") {
  return new Request(`http://localhost/api/test/seed-evening${query}`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("DIVEDAY_E2E_SECRET", secret);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/test/seed-evening", () => {
  it("brings the day home without closing a single count, which is the evening it always seeded", async () => {
    const { db, shop } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);

    const response = await POST(seedRequest());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.moved).toBeGreaterThan(0);
    // Nothing was counted, and the route says so rather than reporting zero
    // writes — which would be indistinguishable from having tried and failed.
    expect(body.closed).toBeNull();

    const closeout = await getDayCloseout(db, shop.id, shop.slug, shop.timezone);
    const evening = assembleEveningClose(closeout.state.departures);
    // The day is over — that half has always worked — and the moment is not
    // claimed, because nobody has been counted back off any of these boats.
    expect(evening.closing).toBe(true);
    expect(evening.allHome).toBe(false);
  });

  it("closes every count on the boats it moved, which is the only way to the coral moment", async () => {
    const { db, shop } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);

    const response = await POST(seedRequest("?heads=closed"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.moved).toBeGreaterThan(0);
    expect(body.closed).toBeGreaterThan(0);

    const closeout = await getDayCloseout(db, shop.id, shop.slug, shop.timezone);
    const evening = assembleEveningClose(closeout.state.departures);
    expect(evening.allHome).toBe(true);
    // `allHome` is only worth photographing if there were divers to bring
    // back: `out > 0` is part of the rule, and a day that sent nobody out
    // would satisfy the rest of it vacuously.
    expect(evening.out).toBeGreaterThan(0);
    expect(evening.back).toBe(evening.out);
    expect(evening.stations.every((station) => station.status === "all_home")).toBe(true);
  });

  it("takes any other value of the parameter as the plain evening, never as a close", async () => {
    // The parameter is read for one exact word. A typo that silently closed
    // the day would make the two captures the same picture again, and the
    // first thing anybody would notice is a visual diff they could not explain.
    const { db, shop } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);

    await POST(seedRequest("?heads=1"));
    const closeout = await getDayCloseout(db, shop.id, shop.slug, shop.timezone);
    expect(assembleEveningClose(closeout.state.departures).allHome).toBe(false);
  });
});
