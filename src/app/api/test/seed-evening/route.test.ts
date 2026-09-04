import { and, desc, eq, gte, isNull, lt, ne } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDayCloseout } from "@/db/closeout";
import { getTripManifest } from "@/db/manifests";
import { bookings, rollCallCrewEvents, rollCallEvents, type Shop, trips } from "@/db/schema";
import { listStaff } from "@/db/trips";
import { nowDate } from "@/lib/clock";
import { assembleEveningClose } from "@/lib/closeout";
import { shopDayBounds } from "@/lib/zoned";
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

/**
 * One of **today's** departures, a seat on it, and somebody to record against.
 *
 * Today's specifically, and via the same shop-day bounds the route itself
 * uses: it only ever moves and counts the departures inside the shop's own
 * calendar day, so a fixture built on any other departure asserts against a
 * boat the route never looked at — which is exactly how the first version of
 * these tests passed for the wrong reason.
 *
 * The **latest** of them, because the route lays the day out backwards from
 * `now` and stops once a departure would fall out of the shop's own day: the
 * earliest boats are the ones it may not reach, so the first row is exactly
 * the wrong one to build a fixture on.
 */
async function aSeatToday(db: Awaited<ReturnType<typeof seededShopContext>>["db"], shop: Shop) {
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("seeded shop has no staff");
  const bounds = shopDayBounds(nowDate(), shop.timezone);
  const rows = await db
    .select({ trip: trips.id, seat: bookings.id })
    .from(trips)
    .innerJoin(bookings, eq(bookings.tripId, trips.id))
    .where(
      and(
        eq(trips.shopId, shop.id),
        eq(trips.status, "scheduled"),
        isNull(trips.deletedAt),
        gte(trips.startsAt, bounds.from),
        lt(trips.startsAt, bounds.to),
        ne(bookings.status, "cancelled"),
      ),
    )
    .orderBy(desc(trips.startsAt))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error("seed has no booked departure today");
  return { trip: row.trip, seat: row.seat, staffId: staff.person.id };
}

/** Every roll-call row the shop holds, divers and crew — the "did it write?" number. */
async function shopRollCallCount(
  db: Awaited<ReturnType<typeof seededShopContext>>["db"],
  shopId: string,
): Promise<number> {
  const [divers, crew] = await Promise.all([
    db
      .select({ id: rollCallEvents.id })
      .from(rollCallEvents)
      .where(eq(rollCallEvents.shopId, shopId)),
    db
      .select({ id: rollCallCrewEvents.id })
      .from(rollCallCrewEvents)
      .where(eq(rollCallCrewEvents.shopId, shopId)),
  ]);
  return divers.length + crew.length;
}

/**
 * Make one recorded result the *whole* of a booking's roll-call history.
 *
 * The seed already writes results for some of today's seats, and the rules
 * under test are about what stands — so a fixture that merely appends is
 * testing the seed's rows as much as its own. Clearing first is what makes the
 * assertion about the rule.
 */
async function onlyResult(
  db: Awaited<ReturnType<typeof seededShopContext>>["db"],
  bookingId: string,
  row: { trip: string; staffId: string; checkpoint: string; status: "boarded" | "not_boarded" },
) {
  const [existing] = await db
    .select({ shopId: rollCallEvents.shopId })
    .from(bookings)
    .innerJoin(rollCallEvents, eq(rollCallEvents.bookingId, bookings.id))
    .where(eq(bookings.id, bookingId))
    .limit(1);
  const [seat] = await db
    .select({ shopId: bookings.shopId })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  const shopId = existing?.shopId ?? seat?.shopId;
  if (!shopId) throw new Error("booking not found");
  await db.delete(rollCallEvents).where(eq(rollCallEvents.bookingId, bookingId));
  await db.insert(rollCallEvents).values({
    shopId,
    tripId: row.trip,
    bookingId,
    recordedByPersonId: row.staffId,
    status: row.status,
    checkpoint: row.checkpoint,
    source: "live",
    occurredAt: nowDate(),
  });
}

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
    expect(body.eventsWritten).toBeNull();

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
    expect(body.eventsWritten).toBeGreaterThan(0);

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

  /**
   * **The crew half, which the first version of this route missed entirely.**
   *
   * No seed in the repository writes a `roll_call_crew_events` row, so a route
   * that took "the crew roster is whoever already has a result" found nobody
   * and wrote nothing — while the demo's departures all have crew *assigned*.
   * The day then reached `allHome` on the shop home with every one of its
   * manifests still reading `crew_awaiting`: the home celebrating a boat whose
   * divemaster nobody had counted. `rollCallCompleteness` counts the assigned
   * crew, so this asserts against the manifest rather than against the row
   * count, because the row count was never the thing that was wrong.
   */
  it("counts the crew the boat was rostered, so the manifests agree with the home", async () => {
    const { db, shop } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);

    const body = await (await POST(seedRequest("?heads=closed"))).json();
    // The route's own list, so this cannot drift onto a departure it never
    // touched — the mistake that made the first version of this test pass.
    const moved: { id: string }[] = body.departures;
    expect(moved.length).toBeGreaterThan(0);

    let crewed = 0;
    for (const trip of moved) {
      const manifest = await getTripManifest(db, shop.id, trip.id);
      const counts = manifest?.completeness.crewCounts;
      if (!counts || counts.crewAssigned === 0) continue;
      crewed += 1;
      // The verdict itself, not the row count: nobody rostered still awaiting,
      // and somebody rostered actually aboard, which is what
      // `rollCallCompleteness` requires before it calls a checkpoint closed.
      expect(counts.crewAwaiting).toBe(0);
      expect(manifest.completeness.crewAccountedFor).toBe(true);
    }
    // The assertion above is vacuous on a shop with no crewed departures, and
    // a seed change could make it so silently.
    expect(crewed).toBeGreaterThan(0);
  });

  /**
   * **A recorded answer is never written over.** The route invents a `boarded`
   * for a booking nobody answered for, which is most of the roster — that is
   * the whole point of it. What it must not do is contradict somebody.
   */
  it("leaves a no-show exactly as the dock recorded them", async () => {
    const { db, shop } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);
    const { trip, seat, staffId } = await aSeatToday(db, shop);
    await onlyResult(db, seat, { trip, staffId, checkpoint: "departure", status: "not_boarded" });

    const before = await shopRollCallCount(db, shop.id);
    expect((await POST(seedRequest("?heads=closed"))).status).toBe(200);

    // Not one row invented for them. A no-show is a closed count whose answer
    // was "they never came", and `inAfterDivePopulation` already leaves them
    // out of every after-dive scan, so nothing was waiting on them.
    const theirs = await db
      .select({ status: rollCallEvents.status })
      .from(rollCallEvents)
      .where(eq(rollCallEvents.bookingId, seat));
    expect(theirs.map((row) => row.status)).toEqual(["not_boarded"]);
    // And the rest of the day was still closed around them, so this is the
    // one booking being skipped rather than the route doing nothing.
    expect(await shopRollCallCount(db, shop.id)).toBeGreaterThan(before);
  });

  /**
   * **The refusal.** A standing `not_boarded` at an after-dive checkpoint is a
   * human saying a body did not come back — the loudest row in the product.
   * The real surface will not let it be cleared without a confirming second
   * tap that names the person, on a separate control, precisely so a wet thumb
   * on a rolling boat cannot turn it green by bouncing. A fixture must not do
   * in a loop what the product refuses to do in one tap, so this route says
   * the day is not clean rather than cleaning it.
   */
  it("refuses the whole day rather than resolve a missing diver", async () => {
    const { db, shop } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);
    const { trip, seat, staffId } = await aSeatToday(db, shop);
    await onlyResult(db, seat, { trip, staffId, checkpoint: "departure", status: "boarded" });
    await db.insert(rollCallEvents).values({
      shopId: shop.id,
      tripId: trip,
      bookingId: seat,
      recordedByPersonId: staffId,
      status: "not_boarded",
      checkpoint: "after_dive_1",
      source: "live",
      occurredAt: nowDate(),
    });

    const before = await shopRollCallCount(db, shop.id);
    const response = await POST(seedRequest("?heads=closed"));
    expect(response.status).toBe(409);
    // Named, because the caller is a visual spec and the alternative to a
    // readable reason is a picture that is quietly of the wrong state.
    expect(await response.json()).toMatchObject({
      ok: false,
      reason: "alarm_standing",
      checkpoint: "after_dive_1",
      tripId: trip,
    });
    // Nothing written on the way to refusing — not for this boat and not for
    // the others, since a half-closed day is the state nobody can read.
    expect(await shopRollCallCount(db, shop.id)).toBe(before);
  });
});
