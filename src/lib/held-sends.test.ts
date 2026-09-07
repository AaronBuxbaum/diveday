import { describe, expect, it } from "vitest";
import {
  heldSendPayloadSchema,
  heldSendRunAt,
  heldSendSecondsLeft,
  isHeldSendDue,
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
        kind: "last_minute_deal",
        tripId: booking,
        discountPercent: 20,
        recipientPersonIds: [],
      }).success,
    ).toBe(false);
    expect(
      heldSendPayloadSchema.safeParse({
        kind: "last_minute_deal",
        tripId: booking,
        discountPercent: 120,
        recipientPersonIds: [booking],
      }).success,
    ).toBe(false);
  });
});
