import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { nowDate } from "@/lib/clock";

vi.mock("@/db/manifests", () => ({ departureRollCallForBooking: vi.fn() }));
vi.mock("../../../../../features/recap/store", () => ({
  bookingsNeverCountedAtRollCall: vi.fn(async () => new Set<string>()),
  departureAfterLateBoarding: vi.fn(),
  getRecapPageState: vi.fn(async () => ({ kind: "recap" })),
}));

const manifests = await import("@/db/manifests");
const recap = await import("../../../../../features/recap/store");
const { readAfterTheDive } = await import("./after-dive-reads");

const db = {} as AppDb;
const HOUR_MS = 60 * 60 * 1000;

function read(endsAgoHours: number, rollCall: "boarded" | "not_boarded" | null, uncounted = false) {
  vi.mocked(manifests.departureRollCallForBooking).mockResolvedValue(rollCall as never);
  vi.mocked(recap.bookingsNeverCountedAtRollCall).mockResolvedValue(
    new Set(uncounted ? ["booking"] : []),
  );
  vi.mocked(recap.departureAfterLateBoarding).mockResolvedValue(rollCall);
  return readAfterTheDive(db, {
    shopId: "shop",
    tripId: "trip",
    endsAt: new Date(nowDate().getTime() - endsAgoHours * HOUR_MS),
    bookingId: "booking",
    identityHeld: false,
  });
}

beforeEach(() => vi.clearAllMocks());

describe("readAfterTheDive's recap read", () => {
  it("never reads the recap between the boat coming home and the floor when no roll call was kept", async () => {
    const afterDive = await read(2, null);
    expect(afterDive.afterTheDive).toBe(false);
    expect(recap.getRecapPageState).not.toHaveBeenCalled();
  });

  it("reads the recap once the roll call says boarded, before the floor", async () => {
    const afterDive = await read(2, "boarded");
    expect(afterDive.afterTheDive).toBe(true);
    expect(recap.getRecapPageState).not.toHaveBeenCalled();
    expect((await afterDive.recap()).kind).toBe("recap");
    expect(recap.getRecapPageState).toHaveBeenCalledTimes(1);
  });

  it("starts the recap beside the roll call past the floor, and reads it once", async () => {
    const afterDive = await read(6, null);
    expect(recap.getRecapPageState).toHaveBeenCalledTimes(1);
    expect(afterDive.afterTheDive).toBe(true);
    await afterDive.recap();
    expect(recap.getRecapPageState).toHaveBeenCalledTimes(1);
  });

  // A diver the crew left at the dock stays on the thread, so the no-show card
  // (`NoShowCard`, reached only from the afterglow branch) never names them.
  it("keeps a diver the crew left at the dock off the afterglow, past the floor too", async () => {
    expect((await read(2, "not_boarded")).afterTheDive).toBe(false);
    expect((await read(30, "not_boarded")).afterTheDive).toBe(false);
  });

  // Issue #3822: the crew counted everyone else and never tapped this diver.
  it("keeps a diver nobody counted off the afterglow on a counted departure, past the floor too", async () => {
    expect((await read(6, null, true)).afterTheDive).toBe(false);
    expect((await read(30, null, true)).afterTheDive).toBe(false);
    // And the speculative recap read is still only a read: the page never turns.
    expect((await read(30, null, false)).afterTheDive).toBe(true);
  });

  it("lets the dock's word outrank the uncounted flag", async () => {
    expect((await read(2, "boarded", true)).afterTheDive).toBe(true);
  });

  it("never reads anything for a boat still out", async () => {
    const afterDive = await read(-2, null);
    expect(afterDive.afterTheDive).toBe(false);
    expect(manifests.departureRollCallForBooking).not.toHaveBeenCalled();
    expect(recap.bookingsNeverCountedAtRollCall).not.toHaveBeenCalled();
    expect(recap.getRecapPageState).not.toHaveBeenCalled();
  });
});
