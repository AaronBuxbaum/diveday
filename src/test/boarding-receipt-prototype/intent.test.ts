import { describe, expect, it } from "vitest";
import { type ReceiptIntent, sameReceiptIntent } from "./intent";

const original: ReceiptIntent = {
  version: 1,
  shopId: "shop-a",
  generationId: "generation-a",
  tripId: "trip-a",
  bookingId: "booking-a",
  meeting: { kind: "known", id: "day-one" },
  actorId: "staff-a",
  clientEventId: "event-a",
  kind: "seen_at_dock",
  occurredAt: "2026-11-18T10:00:00.000Z",
};

describe("prototype receipt intent identity", () => {
  it("recognizes an exact retry of the same observed intent", () => {
    expect(
      sameReceiptIntent(original, { ...original, meeting: { kind: "known", id: "day-one" } }),
    ).toBe(true);
  });

  it.each([
    ["tenant", { shopId: "shop-b" }],
    ["generation", { generationId: "generation-b" }],
    ["trip", { tripId: "trip-b" }],
    ["booking", { bookingId: "booking-b" }],
    ["actor", { actorId: "staff-b" }],
    ["event", { clientEventId: "event-b" }],
    ["occurrence", { occurredAt: "2026-11-18T10:01:00.000Z" }],
    ["meeting day", { meeting: { kind: "known", id: "day-two" } }],
    ["unknown meeting", { meeting: { kind: "unknown" } }],
  ] as const)("does not equate a changed %s with the original", (_label, change) => {
    const changed = { ...original, ...change };
    expect(sameReceiptIntent(original, changed)).toBe(false);
    expect(sameReceiptIntent(changed, original)).toBe(false);
  });

  it("recognizes the same asserted unknown meeting without inferring a day", () => {
    const unknown = { ...original, meeting: { kind: "unknown" } } as const;
    expect(sameReceiptIntent(unknown, { ...unknown })).toBe(true);
  });
});
