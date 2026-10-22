import { describe, expect, it } from "vitest";
import {
  heldSendPayloadSchema,
  heldSendRunAt,
  heldSendSecondsLeft,
  isHeldSendDue,
  mergeRescheduleHolds,
  SEND_HOLD_MS,
} from "./held-sends";

const now = new Date("2026-08-27T10:14:00Z");
const booking = "0f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c";

/** ADR 20260906-before-you-ask, decision 2: the hold's arithmetic. */
describe("heldSendRunAt", () => {
  it("holds a send for eight seconds", () => {
    const runAt = heldSendRunAt(
      { kind: "waiver_send", bookingIds: [booking], channel: "email", surface: "today" },
      now,
    );
    expect(runAt.getTime() - now.getTime()).toBe(SEND_HOLD_MS);
    expect(SEND_HOLD_MS).toBe(8_000);
  });

  it("never holds a copied link — that is a copy, not a send", () => {
    const runAt = heldSendRunAt(
      { kind: "waiver_send", bookingIds: [booking], channel: "link", surface: "diver" },
      now,
    );
    expect(runAt).toEqual(now);
  });
});

describe("isHeldSendDue", () => {
  it("is due once the hold has drained, with a little tolerance for clock skew", () => {
    const runAt = new Date(now.getTime() + SEND_HOLD_MS);
    expect(isHeldSendDue(runAt, now)).toBe(false);
    expect(isHeldSendDue(runAt, new Date(runAt.getTime() - 500))).toBe(true);
    expect(isHeldSendDue(runAt, new Date(runAt.getTime() - 2_000))).toBe(false);
    expect(isHeldSendDue(runAt, runAt)).toBe(true);
  });
});

describe("heldSendSecondsLeft", () => {
  it("counts whole seconds down to zero and never below, from ticks rather than a clock", () => {
    expect(heldSendSecondsLeft(SEND_HOLD_MS, 0)).toBe(8);
    expect(heldSendSecondsLeft(SEND_HOLD_MS, 3_100)).toBe(5);
    expect(heldSendSecondsLeft(SEND_HOLD_MS, 9_000)).toBe(0);
  });
});

describe("heldSendPayloadSchema", () => {
  it("holds ids only, never a name or an address", () => {
    expect(
      heldSendPayloadSchema.safeParse({
        kind: "waiver_send",
        bookingIds: [booking],
        channel: "email",
        surface: "roster",
        tripId: booking,
        diverName: "Priya Sharma",
      }).success,
    ).toBe(true);
    const parsed = heldSendPayloadSchema.parse({
      kind: "waiver_send",
      bookingIds: [booking],
      channel: "email",
      surface: "roster",
      diverName: "Priya Sharma",
    });
    expect(parsed).not.toHaveProperty("diverName");
  });

  it("refuses a deal with nobody to send to, or a discount off the scale", () => {
    expect(
      heldSendPayloadSchema.safeParse({
        kind: "seat_offer",
        tripId: booking,
        discount: { percent: 20 },
        leadIds: [],
      }).success,
    ).toBe(false);
    expect(
      heldSendPayloadSchema.safeParse({
        kind: "seat_offer",
        tripId: booking,
        discount: { percent: 120 },
        leadIds: [booking],
      }).success,
    ).toBe(false);
  });

  it("holds a deal at a percent or a fixed amount, never both and never neither", () => {
    const deal = { kind: "seat_offer", tripId: booking, leadIds: [booking] };
    expect(
      heldSendPayloadSchema.safeParse({ ...deal, discount: { amountCents: 2_000 } }).success,
    ).toBe(true);
    expect(
      heldSendPayloadSchema.safeParse({ ...deal, discount: { percent: 20, amountCents: 2_000 } })
        .success,
    ).toBe(false);
    // No discount is an ordinary offer, not a deal.
    expect(heldSendPayloadSchema.safeParse(deal).success).toBe(true);
    expect(heldSendPayloadSchema.safeParse({ ...deal, discount: { amountCents: 0 } }).success).toBe(
      false,
    );
  });
});

describe("mergeRescheduleHolds", () => {
  const trip = "4b1f6f5e-2c7d-4c47-9a35-0d5c1e3f7a21";
  const other = "9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d";
  const held = (previousStartsAt: string, meetingPointMoved = false, tripId = trip) => ({
    kind: "trip_rescheduled" as const,
    tripId,
    previousStartsAt,
    meetingPointMoved,
  });

  it("tells the divers the time they were last told, however many moves are held", () => {
    const merged = mergeRescheduleHolds(
      [held("2026-10-20T13:00:00.000Z")],
      held("2026-10-21T13:00:00.000Z", true),
      new Date("2026-10-22T13:00:00Z"),
    );
    expect(merged).toEqual(held("2026-10-20T13:00:00.000Z", true));
  });

  it("says nothing when the departure is back where the divers were told it was", () => {
    expect(
      mergeRescheduleHolds(
        [held("2026-10-20T13:00:00.000Z")],
        held("2026-10-21T13:00:00.000Z"),
        new Date("2026-10-20T13:00:00Z"),
      ),
    ).toBeNull();
  });

  // #2443: a save that moved only the meeting point holds a notice whose
  // "before" is the time it still has; there is still something to say.
  it("keeps a meeting-point move even when the time is where the divers were told", () => {
    expect(
      mergeRescheduleHolds(
        [],
        held("2026-10-20T13:00:00.000Z", true),
        new Date("2026-10-20T13:00:00Z"),
      ),
    ).toEqual(held("2026-10-20T13:00:00.000Z", true));
    expect(
      mergeRescheduleHolds(
        [held("2026-10-20T13:00:00.000Z", true)],
        held("2026-10-21T13:00:00.000Z"),
        new Date("2026-10-20T13:00:00Z"),
      ),
    ).toEqual(held("2026-10-20T13:00:00.000Z", true));
  });

  it("never folds another departure's hold into this one", () => {
    const merged = mergeRescheduleHolds(
      [held("2026-10-01T13:00:00.000Z", true, other)],
      held("2026-10-21T13:00:00.000Z"),
      new Date("2026-10-22T13:00:00Z"),
    );
    expect(merged).toEqual(held("2026-10-21T13:00:00.000Z"));
  });

  it("holds ids and instants only", () => {
    expect(
      heldSendPayloadSchema.safeParse({ ...held("2026-10-21T13:00:00.000Z"), to: "a@b.c" }).data,
    ).toEqual(held("2026-10-21T13:00:00.000Z"));
    expect(heldSendPayloadSchema.safeParse(held("next tuesday")).success).toBe(false);
  });
});
