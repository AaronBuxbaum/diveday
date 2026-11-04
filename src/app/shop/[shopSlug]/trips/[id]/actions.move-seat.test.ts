// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { noLevel } from "@/test/admission-refusals";
import { redirectedTo, staffSession } from "@/test/staff-session";

/**
 * **"Move to another departure" answers in the roster's own words** (ADR
 * 20261013-staff-move-a-seat): a seat that stayed says why, a moved seat says
 * whether the diver heard, and a seat that is not on this departure is refused
 * before anything moves. `moveSeat` is mocked here; `src/db/bookings-move.test.ts`
 * is the contract for the move itself.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/session", () => ({ requireShopSurface: vi.fn() }));
vi.mock("@/db/seat-diver", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/seat-diver")>();
  return { ...actual, moveSeat: vi.fn(), moveParty: vi.fn() };
});
vi.mock("@/db/interest-roll", () => ({ carryInterests: vi.fn() }));
vi.mock("./roster-booking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./roster-booking")>();
  return { ...actual, requireRosterBooking: vi.fn() };
});

const { getDb } = await import("@/db/client");
const { moveParty, moveSeat } = await import("@/db/seat-diver");
const { requireShopSurface } = await import("@/lib/session");
const { requireRosterBooking } = await import("./roster-booking");
const { carryInterests } = await import("@/db/interest-roll");
const { carryWaitlistAction, moveSeatAction } = await import("./roster-seating-actions");

const SHOP_SLUG = "reef-life";
const SHOP_ID = "11111111-1111-4111-8111-111111111111";
const STAFF_ID = "22222222-2222-4222-8222-222222222222";
const TRIP_ID = "33333333-3333-4333-8333-333333333333";
const BOOKING_ID = "44444444-4444-4444-8444-444444444444";
const TO_TRIP_ID = "55555555-5555-4555-8555-555555555555";
const back = shopPath(SHOP_SLUG, "trips", TRIP_ID);

function signIn() {
  vi.mocked(getDb).mockResolvedValue({} as never);
  vi.mocked(requireRosterBooking).mockResolvedValue(undefined);
  vi.mocked(requireShopSurface).mockResolvedValue({
    session: staffSession({ shopId: SHOP_ID, shopSlug: SHOP_SLUG, personId: STAFF_ID }),
  } as never);
}

function form() {
  const data = new FormData();
  data.set("bookingId", BOOKING_ID);
  data.set("toTripId", TO_TRIP_ID);
  return data;
}

const moved = {
  ok: true as const,
  personId: STAFF_ID,
  personName: "Nora Quinn",
  fromTripId: TRIP_ID,
  toTripId: TO_TRIP_ID,
  previousStartsAt: new Date("2026-10-20T12:00:00Z"),
  owedCents: 0,
  waiver: "not_needed" as const,
  notice: "told" as const,
  flySafe: { told: 0, failed: 0, unreached: [] },
};

describe("moveSeatAction", () => {
  it("moves the seat on this departure, as the signed-in staffer", async () => {
    signIn();
    vi.mocked(moveSeat).mockResolvedValue(moved);
    expect(await redirectedTo(() => moveSeatAction(SHOP_SLUG, TRIP_ID, form()))).toBe(
      noticeUrl(back, "seat-moved"),
    );
    expect(requireRosterBooking).toHaveBeenCalledWith({}, SHOP_ID, TRIP_ID, BOOKING_ID, back);
    expect(moveSeat).toHaveBeenCalledWith(
      {},
      {
        shopId: SHOP_ID,
        fromTripId: TRIP_ID,
        toTripId: TO_TRIP_ID,
        bookingId: BOOKING_ID,
        actorPersonId: STAFF_ID,
      },
    );
  });

  it.each([
    [{ ...moved, flySafe: "failed" as const }, "seat-moved-fly-safe-unreached"],
    [
      { ...moved, owedCents: 2000, flySafe: { told: 0, failed: 1, unreached: ["Nora"] } },
      "seat-moved-owed-fly-safe-unreached",
    ],
    [{ ...moved, notice: "failed" as const }, "seat-moved-untold"],
    [{ ...moved, owedCents: 2_000 }, "seat-moved-owed"],
    [{ ok: false as const, reason: "on_buddy_team" as const }, "seat-move-buddy"],
    [{ ok: false as const, reason: "divers_full" as const }, "seat-move-full"],
    [{ ok: false as const, reason: "course_unstaffed" as const }, "seat-move-unstaffed"],
    [
      {
        ok: false as const,
        reason: "trip_prerequisite" as const,
        refusal: [noLevel("rescue")],
      },
      "seat-move-prerequisite",
    ],
  ])("answers %o with %s", async (outcome, notice) => {
    signIn();
    vi.mocked(moveSeat).mockResolvedValue(outcome);
    expect(await redirectedTo(() => moveSeatAction(SHOP_SLUG, TRIP_ID, form()))).toBe(
      outcome.ok
        ? noticeUrl(back, notice)
        : noticeUrl(`${back}#move-booking-${BOOKING_ID}`, notice, { bid: BOOKING_ID }),
    );
  });

  it("refuses a departure id that is not an id before anything moves", async () => {
    signIn();
    const data = form();
    data.set("toTripId", "not-a-trip");
    expect(await redirectedTo(() => moveSeatAction(SHOP_SLUG, TRIP_ID, data))).toBe(back);
    expect(moveSeat).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ toTripId: "not-a-trip" }),
    );
  });
});

describe("moveSeatAction, for a party lead", () => {
  function partyForm() {
    const data = form();
    data.set("party", "1");
    return data;
  }
  const partyMoved = {
    ok: true as const,
    seats: [moved, moved, moved].map((seat, index) => ({ ...seat, bookingId: `seat-${index}` })),
  };

  it("moves the whole party and says how many", async () => {
    signIn();
    vi.mocked(moveParty).mockResolvedValue(partyMoved);
    expect(await redirectedTo(() => moveSeatAction(SHOP_SLUG, TRIP_ID, partyForm()))).toBe(
      noticeUrl(back, "party-moved", { count: 3 }),
    );
    expect(moveParty).toHaveBeenCalledWith(
      {},
      {
        shopId: SHOP_ID,
        fromTripId: TRIP_ID,
        toTripId: TO_TRIP_ID,
        leadBookingId: BOOKING_ID,
        actorPersonId: STAFF_ID,
      },
    );
    expect(moveSeat).not.toHaveBeenCalled();
  });

  it("asks for a check when anyone was not told or owes the difference", async () => {
    signIn();
    vi.mocked(moveParty).mockResolvedValue({
      ok: true,
      seats: [moved, { ...moved, notice: "failed" as const }].map((seat, index) => ({
        ...seat,
        bookingId: `seat-${index}`,
      })),
    });
    expect(await redirectedTo(() => moveSeatAction(SHOP_SLUG, TRIP_ID, partyForm()))).toBe(
      noticeUrl(back, "party-moved-check", { count: 2 }),
    );
  });

  it("says why nobody moved, on the lead's row", async () => {
    signIn();
    vi.mocked(moveParty).mockResolvedValue({
      ok: false,
      bookingId: "seat-2",
      outcome: { ok: false, reason: "divers_full" },
    });
    expect(await redirectedTo(() => moveSeatAction(SHOP_SLUG, TRIP_ID, partyForm()))).toBe(
      noticeUrl(`${back}#move-booking-${BOOKING_ID}`, "seat-move-full", { bid: BOOKING_ID }),
    );
  });

  it("goes back to the roster for a seat that leads nobody", async () => {
    signIn();
    vi.mocked(moveParty).mockResolvedValue({
      ok: false,
      bookingId: BOOKING_ID,
      outcome: { ok: false, reason: "not_found" },
    });
    expect(await redirectedTo(() => moveSeatAction(SHOP_SLUG, TRIP_ID, partyForm()))).toBe(back);
  });

  it("refuses a party flag that is not the flag, before anything moves", async () => {
    signIn();
    const data = form();
    data.set("party", "yes");
    expect(await redirectedTo(() => moveSeatAction(SHOP_SLUG, TRIP_ID, data))).toBe(back);
    expect(moveParty).not.toHaveBeenCalled();
  });
});

describe("carryWaitlistAction", () => {
  function carryForm() {
    const data = new FormData();
    data.set("toTripId", TO_TRIP_ID);
    return data;
  }

  it("lands on the departure the interests went to, saying how many", async () => {
    signIn();
    vi.mocked(carryInterests).mockResolvedValue({ ok: true, carried: 3 });
    const landing = shopPath(SHOP_SLUG, "trips", TO_TRIP_ID);
    expect(await redirectedTo(() => carryWaitlistAction(SHOP_SLUG, TRIP_ID, carryForm()))).toBe(
      noticeUrl(landing, "waitlist-carried", { count: 3 }),
    );
    expect(carryInterests).toHaveBeenCalledWith(
      {},
      { shopId: SHOP_ID, fromTripId: TRIP_ID, toTripId: TO_TRIP_ID },
    );
  });

  it("stays put and says so when the departure takes nobody", async () => {
    signIn();
    vi.mocked(carryInterests).mockResolvedValue({ ok: false, reason: "target_unavailable" });
    expect(await redirectedTo(() => carryWaitlistAction(SHOP_SLUG, TRIP_ID, carryForm()))).toBe(
      noticeUrl(back, "waitlist-carry-unavailable"),
    );
  });
});
