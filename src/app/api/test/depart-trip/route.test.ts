import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shops, trips } from "@/db/schema";
import { upcomingTripsWithCounts } from "@/db/trips";
import { HOUR_MS, MINUTE_MS, nowDate } from "@/lib/clock";
import { noShowClaim, noShowGate } from "@/lib/no-show";
import { seededShopContext } from "@/test/db";

/**
 * **What this route is for is a gate answer, not a column.**
 *
 * It exists so a spec can reach the two halves of the counter's no-show door,
 * and those halves are decided by `noShowGate` and `noShowClaim` over the
 * trip's own departure. So the assertions below ask those two rather than
 * comparing timestamps: a route that moved `startsAt` to a time the gate still
 * refuses would satisfy any check about the column and none about the point.
 */

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});

const { getDb } = await import("@/db/client");
const { POST } = await import("./route");

const secret = "e2e-test-secret";

function departRequest(body: unknown, authorized = true) {
  return new Request("http://localhost/api/test/depart-trip", {
    method: "POST",
    headers: authorized
      ? { authorization: `Bearer ${secret}`, "content-type": "application/json" }
      : { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function aTripAhead(db: Awaited<ReturnType<typeof seededShopContext>>["db"], shopId: string) {
  const [trip] = await upcomingTripsWithCounts(db, shopId);
  if (!trip) throw new Error("the seeded shop has to have a departure ahead of it");
  return trip;
}

/** The gate over a booked seat nobody has boarded, which is the row the door is drawn on. */
function doorFor(startsAt: Date) {
  return noShowGate({
    bookingStatus: "booked",
    onTheWater: null,
    tripStatus: "scheduled",
    startsAt,
    now: nowDate(),
  });
}

async function startsAtOf(db: Awaited<ReturnType<typeof seededShopContext>>["db"], tripId: string) {
  const [row] = await db
    .select({ startsAt: trips.startsAt, endsAt: trips.endsAt })
    .from(trips)
    .where(eq(trips.id, tripId))
    .limit(1);
  if (!row) throw new Error("trip vanished");
  return row;
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("DIVEDAY_E2E_SECRET", secret);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/test/depart-trip", () => {
  it("opens the counter's door on a boat that was still ahead a moment ago", async () => {
    const { db, shop } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);
    const trip = await aTripAhead(db, shop.id);
    expect(doorFor(trip.startsAt)).toBe("before_departure");

    const response = await POST(departRequest({ tripId: trip.id, minutesAgo: 10 }));
    expect(response.status).toBe(200);

    const moved = await startsAtOf(db, trip.id);
    expect(doorFor(moved.startsAt)).toBe("eligible");
    // Still the seat's half of the door: inside the hour a late boat is
    // allowed, so the seat is the shop's to sell again.
    expect(noShowClaim({ startsAt: moved.startsAt, now: nowDate() })).toBe("frees_seat");
    // The whole boat slid: one that left earlier is home earlier, and a trip
    // whose return outran its departure would be a day no shop ever has.
    expect(moved.endsAt.getTime() - moved.startsAt.getTime()).toBe(
      trip.endsAt.getTime() - trip.startsAt.getTime(),
    );
  });

  it("reaches the other half of the door once the boat is really gone", async () => {
    const { db, shop } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);
    const trip = await aTripAhead(db, shop.id);

    expect((await POST(departRequest({ tripId: trip.id, minutesAgo: 90 }))).status).toBe(200);

    const moved = await startsAtOf(db, trip.id);
    expect(doorFor(moved.startsAt)).toBe("eligible");
    expect(noShowClaim({ startsAt: moved.startsAt, now: nowDate() })).toBe("did_not_dive");
    // And not so far back that the counter has stopped looking: the door has
    // to still exist for the spec that asked for this state.
    expect(nowDate().getTime() - moved.startsAt.getTime()).toBeLessThan(6 * HOUR_MS);
  });

  it("refuses to drag a departure forwards, so no arrival predates its own boat", async () => {
    const { db, shop } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);
    const trip = await aTripAhead(db, shop.id);
    await db
      .update(trips)
      .set({ startsAt: new Date(nowDate().getTime() - 3 * HOUR_MS) })
      .where(eq(trips.id, trip.id));

    const response = await POST(departRequest({ tripId: trip.id, minutesAgo: 10 }));
    expect(response.status).toBe(409);
    expect(
      await startsAtOf(db, trip.id).then((row) => nowDate().getTime() - row.startsAt.getTime()),
    ).toBeGreaterThan(2 * HOUR_MS);
  });

  it("answers nothing at all without the harness's bearer token", async () => {
    const { db, shop } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);
    const trip = await aTripAhead(db, shop.id);

    const response = await POST(departRequest({ tripId: trip.id, minutesAgo: 10 }, false));
    expect(response.status).toBe(404);
    // Untouched: a refused call is not a partly applied one.
    const still = await startsAtOf(db, trip.id);
    expect(still.startsAt.getTime()).toBe(trip.startsAt.getTime());
    expect(doorFor(still.startsAt)).toBe("before_departure");
  });

  it("refuses a trip that is not this shop's, by the same not-found answer", async () => {
    const { db } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);

    const response = await POST(
      departRequest({ tripId: "00000000-0000-4000-8000-000000000000", minutesAgo: 10 }),
    );
    expect(response.status).toBe(404);
  });

  it("leaves another shop's departure where it is, on both statements", async () => {
    // The id arrives in the request body, so the shop it belongs to is the
    // route's to establish — and the write re-establishes it rather than
    // trusting the read two lines above. A real foreign trip rather than an
    // absent id, because an id that matches nothing cannot tell the two
    // statements apart.
    const { db, shop } = await seededShopContext();
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Reef Runners", slug: "reef-runners", timezone: "America/New_York" })
      .returning();
    if (!otherShop) throw new Error("insert failed");
    expect(otherShop.id).not.toBe(shop.id);
    const startsAt = new Date(nowDate().getTime() + 4 * HOUR_MS);
    const [foreign] = await db
      .insert(trips)
      .values({
        shopId: otherShop.id,
        title: "Reef Runners morning two-tank",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3 * HOUR_MS),
        capacity: 8,
      })
      .returning();
    if (!foreign) throw new Error("insert failed");
    vi.mocked(getDb).mockResolvedValue(db);

    const response = await POST(departRequest({ tripId: foreign.id, minutesAgo: 10 }));
    expect(response.status).toBe(404);

    const still = await startsAtOf(db, foreign.id);
    expect(still.startsAt.getTime()).toBe(startsAt.getTime());
    expect(doorFor(still.startsAt)).toBe("before_departure");
  });

  it("carries the tenant predicate on the write, which no answer of its own can show", async () => {
    // Ids are unique, so nothing a caller can send makes the select clear one
    // trip and the update reach another: the shop filter on the write is
    // defence in depth and invisible at runtime. Pinned where it lives, the
    // way the trip-series route pins its crontab against vercel.json — the
    // alternative is a rule stated in a comment and enforced by nothing.
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const source = readFileSync(
      path.join(process.cwd(), "src/app/api/test/depart-trip/route.ts"),
      "utf8",
    );
    expect(source).toContain(".update(trips)");
    expect(source.slice(source.indexOf(".update(trips)"))).toContain("eq(trips.shopId, shop.id)");
  });

  it("refuses a body with no trip or no distance to move", async () => {
    const { db } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);

    expect((await POST(departRequest({ minutesAgo: 10 }))).status).toBe(400);
    expect((await POST(departRequest({ tripId: "x", minutesAgo: 0 }))).status).toBe(400);
    expect((await POST(departRequest({ tripId: "x", minutesAgo: -MINUTE_MS }))).status).toBe(400);
    // The shapes the hand-rolled parse used to widen away: a number that
    // arrived as text, an id that is not one, and no body at all.
    expect((await POST(departRequest({ tripId: "x", minutesAgo: "10" }))).status).toBe(400);
    expect((await POST(departRequest({ tripId: 7, minutesAgo: 10 }))).status).toBe(400);
    expect((await POST(departRequest({ tripId: "   ", minutesAgo: 10 }))).status).toBe(400);
    expect((await POST(departRequest(undefined))).status).toBe(400);
  });
});
