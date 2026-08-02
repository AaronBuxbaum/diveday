import { describe, expect, it } from "vitest";
import { parseSmsDeliveryEvent } from "./sms-events";

const NOW = new Date("2026-08-02T12:00:00.000Z");

/** The shape SNS writes to CloudWatch for a direct-to-phone-number publish. */
function receipt(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    notification: {
      messageId: "9b7a2e8e-0000-5f2a-9c1d-1e2f3a4b5c6d",
      timestamp: "2026-08-02 11:59:30.123",
    },
    delivery: {
      phoneCarrier: "Verizon",
      destination: "+13055551234",
      priceInUSD: 0.00645,
      smsType: "Transactional",
      providerResponse: "Message has been accepted by phone",
      dwellTimeMs: 512,
    },
    status: "SUCCESS",
    ...overrides,
  });
}

describe("parseSmsDeliveryEvent", () => {
  it("maps a carrier-confirmed SUCCESS to delivered, not merely sent", () => {
    const event = parseSmsDeliveryEvent(receipt(), NOW);

    expect(event).toMatchObject({
      kind: "delivery",
      providerMessageId: "9b7a2e8e-0000-5f2a-9c1d-1e2f3a4b5c6d",
      status: "delivered",
    });
  });

  it("keeps a success free of provider chatter", () => {
    // "Message has been accepted by phone" on a row that already says delivered
    // is noise, not information.
    const event = parseSmsDeliveryEvent(receipt(), NOW);
    expect(event).toMatchObject({ detail: null });
  });

  it("maps FAILURE to failed and keeps the carrier's explanation", () => {
    const event = parseSmsDeliveryEvent(
      receipt({
        status: "FAILURE",
        delivery: { providerResponse: "Phone is currently unreachable/unavailable" },
      }),
      NOW,
    );

    expect(event).toMatchObject({
      kind: "delivery",
      status: "failed",
      detail: "Phone is currently unreachable/unavailable",
    });
  });

  it("survives a failure that carried no provider response", () => {
    const event = parseSmsDeliveryEvent(receipt({ status: "FAILURE", delivery: {} }), NOW);
    expect(event).toMatchObject({ status: "failed", detail: null });
  });

  it("reads the receipt's own timestamp", () => {
    const event = parseSmsDeliveryEvent(
      receipt({ notification: { messageId: "m1", timestamp: "2026-08-02T11:00:00.000Z" } }),
      NOW,
    );

    expect(event).toMatchObject({ occurredAt: new Date("2026-08-02T11:00:00.000Z") });
  });

  it("falls back to now for a missing or unparseable timestamp", () => {
    for (const notification of [
      { messageId: "m1" },
      { messageId: "m1", timestamp: "not-a-date" },
    ]) {
      expect(parseSmsDeliveryEvent(receipt({ notification }), NOW)).toMatchObject({
        occurredAt: NOW,
      });
    }
  });

  it("ignores a status it does not model rather than guessing at it", () => {
    expect(parseSmsDeliveryEvent(receipt({ status: "THROTTLED" }), NOW)).toEqual({
      kind: "ignored",
    });
  });

  it("ignores malformed, empty, and unrelated records without throwing", () => {
    for (const record of [
      "",
      "not json",
      "{}",
      JSON.stringify({ status: "SUCCESS" }),
      JSON.stringify({ notification: { messageId: "" }, status: "SUCCESS" }),
    ]) {
      expect(parseSmsDeliveryEvent(record, NOW)).toEqual({ kind: "ignored" });
    }
  });
});
