import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  seat: vi.fn(),
  party: vi.fn(),
  crew: vi.fn(),
  activity: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: async () => ({}) }));
vi.mock("@/db/operations", () => ({ recordTripActivity: mocks.activity }));
vi.mock("@/db/trips", () => ({ moveTripCrew: mocks.crew }));
vi.mock("@/features/schedule-day", () => ({ readScheduleDay: mocks.read }));
vi.mock("@/features/seat-diver", () => ({ moveSeat: mocks.seat, moveParty: mocks.party }));
vi.mock("@/features/session", () => ({
  requireShopSurface: async () => ({
    session: { user: { personId: ACTOR } },
    shop: { id: SHOP, timezone: "UTC" },
  }),
}));

const { moveDayPersonAction } = await import("./day-actions");
const SHOP = "00000000-0000-4000-8000-000000000001";
const ACTOR = "00000000-0000-4000-8000-000000000002";
const FROM = "00000000-0000-4000-8000-000000000003";
const TO = "00000000-0000-4000-8000-000000000004";
const SEAT = "00000000-0000-4000-8000-000000000005";
const GUEST = "00000000-0000-4000-8000-000000000006";
const success = {
  ok: true,
  owedCents: 0,
  notice: "told",
  waiver: "not_needed",
  flySafe: { unreached: [] },
};
function form() {
  const data = new FormData();
  data.set("from", FROM);
  data.set("to", TO);
  data.set("person", SEAT);
  data.set("kind", "diver");
  data.set("fromProof", "a".repeat(43));
  data.set("toProof", "b".repeat(43));
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue([
    { tripId: FROM, crew: [], divers: [{ id: SEAT, partyLeadBookingId: null }] },
    { tripId: TO, crew: [], divers: [] },
  ]);
});

it("checks conflicts inside the server move and preserves the actor", async () => {
  mocks.seat.mockResolvedValue(success);
  await expect(moveDayPersonAction("reef", "2035-08-04", form())).rejects.toThrow("notice=moved");
  expect(mocks.seat).toHaveBeenCalledWith(
    {},
    {
      shopId: SHOP,
      fromTripId: FROM,
      toTripId: TO,
      bookingId: SEAT,
      actorPersonId: ACTOR,
      rejectScheduleClashes: true,
      expectedDay: {
        day: "2035-08-04",
        timeZone: "UTC",
        fromProof: "a".repeat(43),
        toProof: "b".repeat(43),
      },
    },
  );
});

it("offers a retry when a move times out waiting for the schedule lock", async () => {
  mocks.seat.mockRejectedValue(Object.assign(new Error("lock wait"), { code: "55P03" }));
  await expect(moveDayPersonAction("reef", "2035-08-04", form())).rejects.toThrow("notice=busy");
});

it("does not disguise unrelated move failures as lock contention", async () => {
  mocks.seat.mockRejectedValue(new Error("unexpected"));
  await expect(moveDayPersonAction("reef", "2035-08-04", form())).rejects.toThrow("unexpected");
});

it("moves a lead and followers through the party transaction", async () => {
  mocks.read.mockResolvedValue([
    {
      tripId: FROM,
      crew: [],
      divers: [
        { id: SEAT, partyLeadBookingId: null },
        { id: GUEST, partyLeadBookingId: SEAT },
      ],
    },
    { tripId: TO, crew: [], divers: [] },
  ]);
  mocks.party.mockResolvedValue({ ok: true, seats: [success] });
  await expect(moveDayPersonAction("reef", "2035-08-04", form())).rejects.toThrow("notice=moved");
  expect(mocks.party).toHaveBeenCalledWith(
    {},
    {
      shopId: SHOP,
      fromTripId: FROM,
      toTripId: TO,
      leadBookingId: SEAT,
      actorPersonId: ACTOR,
      rejectScheduleClashes: true,
      expectedDay: {
        day: "2035-08-04",
        timeZone: "UTC",
        fromProof: "a".repeat(43),
        toProof: "b".repeat(43),
      },
    },
  );
  expect(mocks.seat).not.toHaveBeenCalled();
});

it("refuses a stale or forged destination before any move", async () => {
  mocks.read.mockResolvedValue([
    { tripId: FROM, crew: [], divers: [{ id: SEAT, partyLeadBookingId: null }] },
  ]);
  await expect(moveDayPersonAction("reef", "2035-08-04", form())).rejects.toThrow("notice=refused");
  expect(mocks.seat).not.toHaveBeenCalled();
});
