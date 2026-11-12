import { describe, expect, it, vi } from "vitest";
import { createBooking } from "@/db/bookings";
import { createTrip } from "@/db/trips";
import { fileScopedShopContext } from "@/test/db";

vi.mock("@/lib/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications")>();
  return {
    ...actual,
    publicAppUrl: () => "https://diveday.example",
    notify: vi.fn(async () => ({ status: "sent", providerMessageId: "msg" })),
  };
});

const { notify } = await import("@/lib/notifications");
const { sweepMinimumSeats } = await import("./minimum-seats");

const ctx = fileScopedShopContext();

const NOW = new Date("2026-09-01T12:00:00Z");
/** 24h after `NOW`, so a 24-hour window puts the decision exactly at `NOW`. */
const TOMORROW = new Date("2026-09-02T12:00:00Z");

/**
 * A departure that missed its minimum tells every reachable diver, each with
 * the shop's own sender (performance audit 2026-11-11, item 11: the sender is
 * read once per departure, not once per recipient).
 */
describe("sweepMinimumSeats", () => {
  it("tells every emailed diver with the one sender the shop resolves", async () => {
    const { db, shop } = ctx;
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Minimum-seat charter",
      startsAt: TOMORROW,
      endsAt: new Date(TOMORROW.getTime() + 4 * 3_600_000),
      capacity: 9,
      minimumBookings: 4,
      minimumDecisionHours: 24,
    });
    if (!trip) throw new Error("could not create the departure fixture");
    for (const name of ["Ana Reyes", "Ben Ochoa"]) {
      const outcome = await createBooking(db, {
        shopId: shop.id,
        tripId: trip.id,
        actor: "staff",
        fullName: name,
        email: `${name.toLowerCase().replace(/\W+/g, "-")}@example.test`,
      });
      if (!outcome.ok) throw new Error(`could not seat ${name}`);
    }
    vi.mocked(notify).mockClear();

    const summary = await sweepMinimumSeats(db, NOW);

    const calls = vi.mocked(notify).mock.calls.map(([input]) => input);
    const ours = calls.filter((input) => "tripId" in input && input.tripId === trip.id);
    expect(ours.map((input) => input.to).sort()).toEqual([
      "ana-reyes@example.test",
      "ben-ochoa@example.test",
    ]);
    const senders = ours.map((input) => ("sender" in input ? input.sender : undefined));
    expect(senders[0]).toBeDefined();
    expect(senders[1]).toBe(senders[0]);
    expect(summary.notified).toBeGreaterThanOrEqual(2);
  });
});
