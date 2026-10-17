import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The seat action's answer when the seat transaction gave up waiting for a
 * held departure: `55P03` after five seconds (`src/db/lock-bounds.ts`). A
 * staffer at the counter reads "tap again" on the page they were on, never a
 * crash page (layer B domain review, Q5).
 */

vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({ db: "handle" })) }));
vi.mock("@/db/divers", () => ({ findSimilarDivers: vi.fn(async () => []) }));
vi.mock("@/db/seat-diver", () => ({ seatDiver: vi.fn() }));
vi.mock("@/lib/navigation", () => ({
  revalidateAndRedirect: vi.fn((_path: string, to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("@/lib/session", () => ({ requireShopSurface: vi.fn() }));

const { seatDiver } = await import("@/db/seat-diver");
const { requireShopSurface } = await import("@/lib/session");
const { seatExistingDiverAction } = await import("./seat-diver");

const SHOP_ID = "22222222-2222-4222-8222-222222222222";
const TRIP_ID = "33333333-3333-4333-8333-333333333333";
const DIVER_ID = "44444444-4444-4444-8444-444444444444";

function form(): FormData {
  const data = new FormData();
  data.set("tripId", TRIP_ID);
  data.set("personId", DIVER_ID);
  return data;
}

/** Where the action sent the staffer. */
async function landing(): Promise<string> {
  try {
    await seatExistingDiverAction("trip-guests", "blue-mantis", form());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw error;
  }
  throw new Error("the action neither redirected nor threw");
}

/** What drizzle throws for a lock wait Postgres gave up on. */
function lockWaitRefusal(): Error {
  const driver = Object.assign(new Error("canceling statement due to lock timeout"), {
    code: "55P03",
  });
  return new Error("Failed query: insert into bookings", { cause: driver });
}

beforeEach(() => {
  vi.mocked(requireShopSurface).mockResolvedValue({
    session: { user: { shopId: SHOP_ID, personId: "staff" } },
  } as never);
});

afterEach(() => vi.clearAllMocks());

describe("seatExistingDiverAction under a held departure", () => {
  it("sends the staffer back to the trip with the busy notice", async () => {
    vi.mocked(seatDiver).mockRejectedValue(lockWaitRefusal());
    expect(await landing()).toBe(`/shop/blue-mantis/trips/${TRIP_ID}?notice=seat-busy`);
  });

  it("still throws anything that is not a lock wait", async () => {
    const deadlock = Object.assign(new Error("deadlock detected"), { code: "40P01" });
    vi.mocked(seatDiver).mockRejectedValue(new Error("Failed query", { cause: deadlock }));
    await expect(landing()).rejects.toThrow("Failed query");
  });
});
