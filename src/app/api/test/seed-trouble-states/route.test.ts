import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inHorizonReadiness } from "@/db/blockers";
import { getGearItemDetail } from "@/db/gear-register";
import { listGearRentals } from "@/db/gear-rentals";
import { getTripManifest } from "@/db/manifests";
import { listTripReadiness } from "@/db/readiness";
import { listOwedShopCancellationRefunds } from "@/db/refunds";
import { bookings, people, trips } from "@/db/schema";
import { getShopDayDepartures } from "@/db/today";
import { liveTrip } from "@/db/trips-live";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { counterRentalWaiverFlag } from "@/lib/counter-rentals";
import { benchReturnConcerns } from "@/lib/gear";
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
  it("opens enough capacity for the party waiver captures when asked", async () => {
    const { db, shop } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);

    const [trip] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(
        and(
          eq(trips.shopId, shop.id),
          eq(trips.title, "Morning Two-Tank — Molasses Reef"),
          liveTrip(),
        ),
      )
      .limit(1);
    if (!trip) throw new Error("party waiver visual departure was not seeded");

    const response = await POST(seedRequest("?partyWaiverCapacity=1"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      partyWaiverCapacity?: { tripId: string; capacity: number };
    };
    expect(body.partyWaiverCapacity?.tripId).toBe(trip.id);
    expect(body.partyWaiverCapacity?.capacity).toBeGreaterThanOrEqual(20);

    const [updated] = await db
      .select({ capacity: trips.capacity })
      .from(trips)
      .where(eq(trips.id, trip.id));
    expect(updated?.capacity).toBeGreaterThanOrEqual(20);
  }, 60_000);

  it("does not seed the rental lookup without its bearer or against a real database", async () => {
    vi.mocked(getDb).mockClear();
    const denied = await POST(
      new Request("http://localhost/api/test/seed-trouble-states?rentalLookup=1", {
        method: "POST",
      }),
    );
    expect(denied.status).toBe(404);
    vi.stubEnv("DATABASE_URL", "postgres://example.invalid/not-a-test-database");
    expect((await POST(seedRequest("?rentalLookup=1"))).status).toBe(404);
    expect(getDb).not.toHaveBeenCalled();
  });

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

  /**
   * **A checked-in diver who can no longer board** (#2410): the state the
   * counter must keep under "Still to clear", made through the real check-in.
   */
  it("checks a diver in and then blocks them when asked", async () => {
    const { db, shop } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);

    const response = await POST(seedRequest("?checkedInBlocked=1"));
    const body = (await response.json()) as {
      checkedInBlocked?: { tripId: string; personName: string };
    };
    if (!body.checkedInBlocked) throw new Error("no checked-in blocked diver was made");
    const { tripId, personName } = body.checkedInBlocked;
    const row = (await listTripReadiness(db, shop.id, tripId)).find(
      (entry) => entry.person.fullName === personName,
    );
    expect(row?.booking.status).toBe("checked_in");
    expect(row?.readiness.status).toBe("blocked");
  }, 60_000);

  /**
   * **A concern returned onto the unit already on the bench** (#2570): the
   * status card's "Returned … with a concern" line needs a unit off the wall
   * and a return whose words are not the unit's own note.
   */
  it("returns the benched regulator with a concern when asked, and not otherwise", async () => {
    const { db, shop } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);

    const calm = (await (await POST(seedRequest("?boatSafety=1"))).json()) as {
      gearConcern?: unknown;
    };
    expect(calm.gearConcern).toBeUndefined();

    const body = (await (await POST(seedRequest("?gearConcern=1"))).json()) as {
      gearConcern?: { gearItemId: string; label: string };
    };
    if (!body.gearConcern) throw new Error("no concern was returned");
    const detail = await getGearItemDetail(db, shop.id, body.gearConcern.gearItemId);
    if (!detail) throw new Error("the benched unit is missing");
    expect(detail.item.status).toBe("needs_service");
    const concerns = benchReturnConcerns(
      detail.item,
      detail.reservations,
      detail.history,
      shop.timezone,
    );
    expect(concerns).toHaveLength(1);
    expect(concerns[0]?.note).toMatch(/Mouthpiece split/);

    // Idempotent: a second ask does not stack a second return.
    await POST(seedRequest("?gearConcern=1"));
    const again = await getGearItemDetail(db, shop.id, body.gearConcern.gearItemId);
    expect(
      benchReturnConcerns(again?.item ?? detail.item, again?.reservations ?? [], [], shop.timezone),
    ).toHaveLength(1);
  }, 60_000);

  /**
   * **A counter rental out to someone with no waiver** (#2570): the Rentals
   * list's waiver word only shows for a holder the shop has no signature for.
   */
  it("lends a mask to someone with no waiver when asked", async () => {
    const { db, shop } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);

    const body = (await (await POST(seedRequest("?rentalWaiverWarning=1"))).json()) as {
      rentalWaiverWarning?: { personId: string; label: string };
    };
    if (!body.rentalWaiverWarning) throw new Error("no rental was made");
    const page = await listGearRentals(db, shop.id, {
      todayLocal: calendarDateInTimezone(nowDate(), shop.timezone),
      timezone: shop.timezone,
    });
    const standing = page.counterWaivers?.get(body.rentalWaiverWarning.personId);
    expect(standing && counterRentalWaiverFlag(standing.state)).toBeTruthy();
    expect(page.rows.some((holder) => holder.personId === body.rentalWaiverWarning?.personId)).toBe(
      true,
    );
  }, 60_000);

  /**
   * **One seat the dock never counted on the finished dawn boat** (#2408), so
   * its record shows every outcome band.
   */
  it("leaves one seat on the finished boat with no dock result when asked", async () => {
    const { db, shop } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);

    const response = await POST(seedRequest("?uncountedSeat=1"));
    const body = (await response.json()) as {
      uncountedSeat?: { tripId: string; personName: string };
    };
    if (!body.uncountedSeat) throw new Error("no uncounted seat was made");
    const { tripId, personName } = body.uncountedSeat;
    const manifest = await getTripManifest(db, shop.id, tripId);
    const states = new Map(
      manifest?.divers.map((diver) => [diver.fullName, diver.rollCall?.state]),
    );
    expect(states.get(personName)).toBeUndefined();
    expect(states.has(personName)).toBe(true);
    expect([...states.values()]).toContain("boarded");
    expect([...states.values()]).toContain("not_boarded");
    const [seat] = await db
      .select({ status: bookings.status })
      .from(bookings)
      .innerJoin(people, eq(people.id, bookings.personId))
      .where(and(eq(bookings.tripId, tripId), eq(people.fullName, personName)));
    expect(seat?.status).toBe("checked_in");
  }, 60_000);

  /**
   * **A full boat nobody has counted the crew on**: the station's warning
   * needs every seat aboard. The demo's morning hand-off checks two divers in
   * on that boat, so a helper that boarded only `booked` seats left them
   * ashore and the warning never showed.
   */
  it("boards every seat on the next boat, checked in or not, and counts no crew", async () => {
    const { db, shop } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);
    const now = nowDate();
    const nextOf = async () => {
      const evidence = await inHorizonReadiness(db, shop.id, now);
      const cards = await getShopDayDepartures(db, shop.id, shop.timezone, now, evidence);
      const card = cards
        .filter((entry) => entry.startsAt.getTime() >= now.getTime() - HOUR_MS)
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
      if (!card) throw new Error("no departure left today");
      return card;
    };
    // A diver the counter has already checked in, as the demo's hand-off does.
    const [seat] = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.tripId, (await nextOf()).tripId), eq(bookings.status, "booked")))
      .limit(1);
    if (!seat) throw new Error("the next boat has no booked seat");
    await db.update(bookings).set({ status: "checked_in" }).where(eq(bookings.id, seat.id));

    const response = await POST(seedRequest("?crewUncounted=1"));
    expect(response.status).toBe(200);

    const next = await nextOf();
    expect(next.booked).toBeGreaterThan(0);
    expect(next.boarded).toBe(next.booked);
    expect(next.blocked).toBe(0);
    expect(next.crewAccountedFor).toBe(false);
  }, 60_000);
});
