import { beforeEach, expect, it, vi } from "vitest";
import type { AppDb } from "../../db/client";
import { getRequestsPage } from "./store";

const mocks = vi.hoisted(() => ({
  away: vi.fn(),
  departures: vi.fn(),
}));
vi.mock("@/features/boats", () => ({ listBoats: vi.fn(async () => []) }));
vi.mock("@/features/crew-away", () => ({ crewAwayByTrip: mocks.away }));
vi.mock("../../db/authz", () => ({ canPersonConfigureTrips: vi.fn(async () => true) }));
vi.mock("../../db/interest-dates", () => ({
  countWaitingDateInterests: vi.fn(async () => 0),
  listClosedDateInterests: vi.fn(async () => []),
  listOpenDateInterests: vi.fn(async () => ({ rows: [], total: 0 })),
  listDeparturesOnDates: mocks.departures,
}));
const db = {} as AppDb;
const shop = {
  id: "shop",
  timezone: "America/New_York",
  dateRequestsEnabled: true,
  crewScheduleEnabled: true,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.departures.mockResolvedValue([{ tripId: "trip", date: "2027-03-06" }]);
  mocks.away.mockResolvedValue(
    new Map([["trip", [{ acknowledged: false }, { acknowledged: true }]]]),
  );
});
it("uses the existing crew schedule reader and counts only unconfirmed time away", async () => {
  const page = await getRequestsPage(db, shop, "staff", 1);
  expect(mocks.away).toHaveBeenCalledWith(db, shop.id, ["trip"], shop.timezone);
  expect(!page.gone && page.crewAwayCountByTrip.get("trip")).toBe(1);
});
it("does not read time away when crew schedules are disabled", async () => {
  const page = await getRequestsPage(db, { ...shop, crewScheduleEnabled: false }, "staff", 1);
  expect(mocks.away).not.toHaveBeenCalled();
  expect(!page.gone && page.crewAwayCountByTrip.size).toBe(0);
});
