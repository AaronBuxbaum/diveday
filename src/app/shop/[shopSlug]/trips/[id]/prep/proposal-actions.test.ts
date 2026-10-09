// @vitest-environment node
import { and, eq, gte, isNull, lte, ne } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBooking } from "@/db/bookings";
import type { AppDb } from "@/db/client";
import { createGearItem } from "@/db/gear";
import { bookings, gearReservations, shops } from "@/db/schema";
import { setTripStatus, upcomingTripsWithCounts } from "@/db/trips";
import { createTrip } from "@/db/trips-create";
import { getTripPrep } from "@/db/trips-prep";
import { nowDate } from "@/lib/clock";
import { gearKindIsLifeSupport, tripReservationWindow } from "@/lib/gear";
import { seededShopContext } from "@/test/db";
import { staffSession } from "@/test/staff-session";

/**
 * **"Assign all" against a real database**, with only the session, the cache
 * and the database handle faked (the security and dive-domain reviews of the
 * Gear tab's proposals). Every refusal below is the action's or the write's,
 * never the page's: a forged post or a stale tab reaches this action exactly
 * as these tests do.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/db/gear", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/gear")>();
  return { ...actual, reserveGearUnit: vi.fn(actual.reserveGearUnit) };
});
vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));

const { revalidatePath } = await import("next/cache");
const { getDb } = await import("@/db/client");
const { reserveGearUnit } = await import("@/db/gear");
const { requireStaffSession } = await import("@/lib/session");
const { confirmProposedGearUnits } = await import("./proposal-actions");
const { assignGearUnit } = await import("./actions");

afterEach(() => {
  vi.clearAllMocks();
});

const PREP_PATH = (shopSlug: string, tripId: string) => `/shop/${shopSlug}/trips/${tripId}/prep`;

async function context() {
  const { db, shop } = await seededShopContext();
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({
      shopId: shop.id,
      shopSlug: shop.slug,
      personId: "00000000-0000-4000-8000-000000000001",
      roles: ["owner"],
    }) as never,
  );
  const prep = await reefPrep(db, shop);
  const picks = [...prep.proposals.entries()].map(([key, unit]) => ({
    bookingId: key.slice(0, key.lastIndexOf(":")),
    gearItemId: unit.id,
    kind: unit.kind,
  }));
  if (picks.length === 0) throw new Error("the seeded reef trip proposes nothing");
  tripWindow = tripReservationWindow(prep.trip, shop.timezone);
  return { db, shop, tripId: prep.trip.id, prep, picks };
}

async function reefPrep(db: AppDb, shop: Awaited<ReturnType<typeof seededShopContext>>["shop"]) {
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((entry) => entry.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const prep = await getTripPrep(db, shop, reef.id);
  if (!prep) throw new Error("prep missing for the seeded trip");
  return prep;
}

/** The departure being prepped's dates, set by `context()`. */
let tripWindow = { from: "", until: "" };

/**
 * What holds this unit over the departure's dates. The seeded fleet has a
 * history of its own, so a unit's every reservation is not the question;
 * whether anything now holds it for these dates is.
 */
async function reservationsFor(db: AppDb, gearItemId: string) {
  return db
    .select()
    .from(gearReservations)
    .where(
      and(
        eq(gearReservations.gearItemId, gearItemId),
        isNull(gearReservations.returnedAt),
        lte(gearReservations.reservedFrom, tripWindow.until),
        gte(gearReservations.reservedUntil, tripWindow.from),
      ),
    );
}

async function rivalShop(db: AppDb) {
  const [rival] = await db
    .insert(shops)
    .values({ name: "Rival Reef", slug: "rival-reef-proposals", timezone: "America/New_York" })
    .returning();
  if (!rival) throw new Error("rival shop insert failed");
  return rival;
}

async function bookingOn(db: AppDb, shopId: string, name: string) {
  const startsAt = new Date("2026-09-01T12:00:00Z");
  const trip = await createTrip(db, {
    shopId,
    title: `Proposal test departure — ${name}`,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
    capacity: 8,
    plannedDives: 2,
  });
  if (!trip) throw new Error("trip insert failed");
  const booking = await createBooking(db, {
    shopId,
    tripId: trip.id,
    actor: "staff",
    fullName: name,
    email: `${name.toLowerCase().replace(/[^a-z]+/g, "-")}@example.com`,
  });
  if (!booking.ok) throw new Error(`booking failed: ${booking.reason}`);
  return booking.bookingId;
}

/**
 * The unit came home from an earlier reservation flagged as a service concern
 * after the Gear tab loaded, and nobody has answered it.
 */
async function flagServiceConcern(
  db: AppDb,
  shopId: string,
  pick: { bookingId: string; gearItemId: string },
) {
  await db.insert(gearReservations).values({
    shopId,
    gearItemId: pick.gearItemId,
    bookingId: pick.bookingId,
    reservedFrom: "2026-01-10",
    reservedUntil: "2026-01-10",
    checkedOutAt: new Date("2026-01-10T12:00:00.000Z"),
    returnedAt: nowDate(),
    returnOutcome: "service_concern",
    returnNote: "Second stage free-flows",
  });
}

const only = (pick: { bookingId: string; gearItemId: string }) => ({
  bookingId: pick.bookingId,
  gearItemId: pick.gearItemId,
});

describe("confirmProposedGearUnits", () => {
  it("reserves every proposal it was shown, and refreshes the Gear tab", async () => {
    const { db, shop, tripId, picks } = await context();
    expect(await confirmProposedGearUnits({ tripId, picks: picks.map(only) })).toEqual({
      ok: true,
      assigned: picks.length,
      refused: 0,
    });
    for (const pick of picks) expect(await reservationsFor(db, pick.gearItemId)).toHaveLength(1);
    expect(revalidatePath).toHaveBeenCalledWith(PREP_PATH(shop.slug, tripId));
  });

  it("refuses another shop's unit", async () => {
    const { db, tripId, picks } = await context();
    const rival = await rivalShop(db);
    const created = await createGearItem(db, {
      shopId: rival.id,
      kind: picks[0].kind,
      label: "Rival unit",
    });
    if (!created.ok) throw new Error("rival unit insert failed");
    expect(
      await confirmProposedGearUnits({
        tripId,
        picks: [{ bookingId: picks[0].bookingId, gearItemId: created.item.id }],
      }),
    ).toEqual({ ok: true, assigned: 0, refused: 1 });
    expect(await reservationsFor(db, created.item.id)).toEqual([]);
  });

  it("refuses a booking from another departure of the same shop", async () => {
    const { db, shop, tripId, picks } = await context();
    const [elsewhere] = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.shopId, shop.id),
          ne(bookings.tripId, tripId),
          eq(bookings.status, "booked"),
        ),
      )
      .limit(1);
    if (!elsewhere) throw new Error("the seed has no booking on another departure");
    expect(
      await confirmProposedGearUnits({
        tripId,
        picks: [{ bookingId: elsewhere.id, gearItemId: picks[0].gearItemId }],
      }),
    ).toEqual({ ok: true, assigned: 0, refused: 1 });
    expect(await reservationsFor(db, picks[0].gearItemId)).toEqual([]);
  });

  it("refuses a booking from another shop", async () => {
    const { db, tripId, picks } = await context();
    const rival = await rivalShop(db);
    const foreignBooking = await bookingOn(db, rival.id, "Rival Diver");
    expect(
      await confirmProposedGearUnits({
        tripId,
        picks: [{ bookingId: foreignBooking, gearItemId: picks[0].gearItemId }],
      }),
    ).toEqual({ ok: true, assigned: 0, refused: 1 });
    expect(await reservationsFor(db, picks[0].gearItemId)).toEqual([]);
  });

  it("reserves nothing on a cancelled departure", async () => {
    const { db, shop, tripId, picks } = await context();
    await setTripStatus(db, shop.id, tripId, "cancelled");
    expect(await confirmProposedGearUnits({ tripId, picks: picks.map(only) })).toEqual({
      ok: false,
      reason: "invalid",
    });
    for (const pick of picks) expect(await reservationsFor(db, pick.gearItemId)).toEqual([]);
  });

  it("lets nobody but staff in", async () => {
    const { db, tripId, picks } = await context();
    vi.mocked(requireStaffSession).mockRejectedValueOnce(new Error("not_authorized"));
    await expect(confirmProposedGearUnits({ tripId, picks: picks.map(only) })).rejects.toThrow(
      "not_authorized",
    );
    for (const pick of picks) expect(await reservationsFor(db, pick.gearItemId)).toEqual([]);
  });

  it("refuses an empty post and one past the bound, whole", async () => {
    const { tripId, picks } = await context();
    expect(await confirmProposedGearUnits({ tripId, picks: [] })).toEqual({
      ok: false,
      reason: "invalid",
    });
    const many = Array.from({ length: 401 }, (_unused, index) => ({
      bookingId: picks[0].bookingId,
      gearItemId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    }));
    expect(await confirmProposedGearUnits({ tripId, picks: many })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(reserveGearUnit).not.toHaveBeenCalled();
  });

  it("refuses a post that names one unit twice, whole", async () => {
    const { db, tripId, picks } = await context();
    const [first] = picks;
    const other = picks.find((pick) => pick.bookingId !== first.bookingId) ?? first;
    expect(
      await confirmProposedGearUnits({
        tripId,
        picks: [only(first), { bookingId: other.bookingId, gearItemId: first.gearItemId }],
      }),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(await confirmProposedGearUnits({ tripId, picks: [only(first), only(first)] })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await reservationsFor(db, first.gearItemId)).toEqual([]);
  });

  /**
   * The stale tab. A colleague assigned this diver a unit from another tab;
   * this one still proposes a second of the same kind. The diver keeps the
   * one they hold and the stale pick is counted as refused.
   */
  it("refuses a second unit of a kind the diver already holds", async () => {
    const { db, shop, tripId, prep, picks } = await context();
    const stale = picks.find((pick) => pick.kind === "bcd") ?? picks[0];
    const held = (prep.freeByKind.get(stale.kind) ?? []).find(
      (unit) => unit.id !== stale.gearItemId,
    );
    if (!held) throw new Error(`the seed has only one free ${stale.kind}`);
    const dates = tripReservationWindow(prep.trip, shop.timezone);
    const { reserveGearUnit: realReserve } =
      await vi.importActual<typeof import("@/db/gear")>("@/db/gear");
    const first = await realReserve(db, {
      shopId: shop.id,
      gearItemId: held.id,
      bookingId: stale.bookingId,
      tripId,
      reservedFrom: dates.from,
      reservedUntil: dates.until,
      screen: { proposed: false },
    });
    if (!first.ok) throw new Error(`could not hold ${held.label}: ${first.reason}`);

    expect(await confirmProposedGearUnits({ tripId, picks: [only(stale)] })).toEqual({
      ok: true,
      assigned: 0,
      refused: 1,
    });
    expect(await reservationsFor(db, stale.gearItemId)).toEqual([]);
  });

  it("counts a pick whose write throws as refused, carries on, and still refreshes", async () => {
    const { db, shop, tripId, picks } = await context();
    vi.mocked(reserveGearUnit).mockRejectedValueOnce(new Error("connection reset"));
    const result = await confirmProposedGearUnits({ tripId, picks: picks.map(only) });
    expect(result).toEqual({ ok: true, assigned: picks.length - 1, refused: 1 });
    expect(await reservationsFor(db, picks[0].gearItemId)).toEqual([]);
    expect(revalidatePath).toHaveBeenCalledWith(PREP_PATH(shop.slug, tripId));
  });
});

/**
 * **A proposal is re-read for care at confirm time** (second dive-domain
 * review of the proposals). The tab offered the unit because nothing was wrong
 * with it when the page loaded; one flagged since is refused, never reserved
 * on a confirmation nobody looked at again.
 */
describe("confirming a proposal whose unit needs care since the tab loaded", () => {
  it("refuses that pick as a refused count and reserves the rest", async () => {
    const { db, shop, tripId, picks } = await context();
    const [flagged] = picks;
    await flagServiceConcern(db, shop.id, flagged);
    expect(await confirmProposedGearUnits({ tripId, picks: picks.map(only) })).toEqual({
      ok: true,
      assigned: picks.length - 1,
      refused: 1,
    });
    expect(await reservationsFor(db, flagged.gearItemId)).toEqual([]);
  });
});

describe("assignGearUnit", () => {
  it("reserves a proposed pick whose unit needs nothing", async () => {
    const { db, tripId, picks } = await context();
    const [pick] = picks;
    expect(await assignGearUnit({ tripId, ...only(pick), proposed: true })).toEqual({ ok: true });
    expect(await reservationsFor(db, pick.gearItemId)).toHaveLength(1);
  });

  it("refuses a proposed pick whose unit gained a service concern", async () => {
    const { db, shop, tripId, picks } = await context();
    const [pick] = picks;
    await flagServiceConcern(db, shop.id, pick);
    expect(await assignGearUnit({ tripId, ...only(pick), proposed: true })).toEqual({
      ok: false,
      reason: "needs_care",
    });
    expect(await reservationsFor(db, pick.gearItemId)).toEqual([]);
  });

  it("still lets a hand pick choose a labeled unit, knowingly", async () => {
    const { db, shop, tripId, picks } = await context();
    const pick = picks.find((entry) => !gearKindIsLifeSupport(entry.kind));
    if (!pick) throw new Error("the seeded reef trip proposes only life support");
    await flagServiceConcern(db, shop.id, pick);
    expect(await assignGearUnit({ tripId, ...only(pick) })).toEqual({ ok: true });
    expect(await reservationsFor(db, pick.gearItemId)).toHaveLength(1);
  });

  /**
   * **Life support asks first** (dive-domain review of issue #2215): a
   * hand-picked BCD, regulator or computer that needs care is assigned only
   * once the staffer says "Assign anyway".
   */
  it("asks before a hand-picked life-support unit that needs care, then assigns it anyway", async () => {
    const { db, shop, tripId, picks } = await context();
    const pick = picks.find((entry) => gearKindIsLifeSupport(entry.kind));
    if (!pick) throw new Error("the seeded reef trip proposes no life support");
    await flagServiceConcern(db, shop.id, pick);
    expect(await assignGearUnit({ tripId, ...only(pick) })).toEqual({
      ok: false,
      reason: "needs_care_confirm",
    });
    expect(await reservationsFor(db, pick.gearItemId)).toHaveLength(0);
    expect(await assignGearUnit({ tripId, ...only(pick), assignAnyway: true })).toEqual({
      ok: true,
    });
    expect(await reservationsFor(db, pick.gearItemId)).toHaveLength(1);
  });
});
