import { describe, expect, it } from "vitest";
import { parseSesEmailEvent } from "./ses-events";

const now = new Date("2026-08-02T18:00:00.000Z");

describe("parseSesEmailEvent", () => {
  it("parses a bounce and prefers the recipient's own diagnostic code", () => {
    const event = parseSesEmailEvent(
      JSON.stringify({
        eventType: "Bounce",
        mail: { messageId: "ses-msg-1", timestamp: "2026-08-02T17:00:00.000Z" },
        bounce: {
          timestamp: "2026-08-02T17:05:00.000Z",
          bounceType: "Permanent",
          bounceSubType: "General",
          bouncedRecipients: [{ diagnosticCode: "smtp; 550 5.1.1 mailbox unavailable" }],
        },
      }),
      now,
    );
    expect(event).toEqual({
      kind: "delivery",
      providerMessageId: "ses-msg-1",
      status: "bounced",
      detail: "smtp; 550 5.1.1 mailbox unavailable",
      recipient: null,
      shopId: null,
      occurredAt: new Date("2026-08-02T17:05:00.000Z"),
    });
  });

  it("falls back to the bounce type/subtype when no diagnostic code is given", () => {
    const event = parseSesEmailEvent(
      JSON.stringify({
        eventType: "Bounce",
        mail: { messageId: "ses-msg-2" },
        bounce: { bounceType: "Permanent", bounceSubType: "Suppressed" },
      }),
      now,
    );
    expect(event).toMatchObject({ kind: "delivery", detail: "Permanent / Suppressed" });
  });

  it("parses a complaint", () => {
    const event = parseSesEmailEvent(
      JSON.stringify({
        eventType: "Complaint",
        mail: { messageId: "ses-msg-3" },
        complaint: { timestamp: "2026-08-02T17:10:00.000Z", complaintFeedbackType: "abuse" },
      }),
      now,
    );
    expect(event).toEqual({
      kind: "delivery",
      providerMessageId: "ses-msg-3",
      status: "complained",
      detail: "abuse",
      recipient: null,
      shopId: null,
      occurredAt: new Date("2026-08-02T17:10:00.000Z"),
    });
  });

  it("parses a delivery", () => {
    const event = parseSesEmailEvent(
      JSON.stringify({
        eventType: "Delivery",
        mail: { messageId: "ses-msg-4" },
        delivery: { timestamp: "2026-08-02T17:15:00.000Z" },
      }),
      now,
    );
    expect(event).toEqual({
      kind: "delivery",
      providerMessageId: "ses-msg-4",
      status: "delivered",
      detail: null,
      recipient: null,
      shopId: null,
      occurredAt: new Date("2026-08-02T17:15:00.000Z"),
    });
  });

  it("parses a delivery delay", () => {
    const event = parseSesEmailEvent(
      JSON.stringify({
        eventType: "DeliveryDelay",
        mail: { messageId: "ses-msg-5" },
        deliveryDelay: { timestamp: "2026-08-02T17:20:00.000Z" },
      }),
      now,
    );
    expect(event).toMatchObject({ status: "delivery_delayed" });
  });

  it("parses a reject with its reason", () => {
    const event = parseSesEmailEvent(
      JSON.stringify({
        eventType: "Reject",
        mail: { messageId: "ses-msg-6" },
        reject: { reason: "Virus" },
      }),
      now,
    );
    expect(event).toMatchObject({ status: "failed", detail: "Virus" });
  });

  it("parses a rendering failure with its error message", () => {
    const event = parseSesEmailEvent(
      JSON.stringify({
        eventType: "RenderingFailure",
        mail: { messageId: "ses-msg-7" },
        failure: { errorMessage: "Missing template data" },
      }),
      now,
    );
    expect(event).toMatchObject({ status: "failed", detail: "Missing template data" });
  });

  it("ignores Open (opens/clicks are a separate engagement path, not delivery status)", () => {
    const event = parseSesEmailEvent(
      JSON.stringify({ eventType: "Open", mail: { messageId: "ses-msg-8" } }),
      now,
    );
    expect(event).toEqual({ kind: "ignored" });
  });

  it("ignores Click", () => {
    const event = parseSesEmailEvent(
      JSON.stringify({ eventType: "Click", mail: { messageId: "ses-msg-9" } }),
      now,
    );
    expect(event).toEqual({ kind: "ignored" });
  });

  it("ignores Subscription and any unmodeled event type", () => {
    expect(
      parseSesEmailEvent(
        JSON.stringify({ eventType: "Subscription", mail: { messageId: "x" } }),
        now,
      ),
    ).toEqual({ kind: "ignored" });
    expect(
      parseSesEmailEvent(
        JSON.stringify({ eventType: "SomethingNew", mail: { messageId: "x" } }),
        now,
      ),
    ).toEqual({ kind: "ignored" });
  });

  it("ignores malformed JSON", () => {
    expect(parseSesEmailEvent("not json", now)).toEqual({ kind: "ignored" });
  });

  it("ignores an event missing mail.messageId", () => {
    expect(parseSesEmailEvent(JSON.stringify({ eventType: "Bounce", mail: {} }), now)).toEqual({
      kind: "ignored",
    });
  });

  it("falls back to now when no timestamp is present anywhere", () => {
    const event = parseSesEmailEvent(
      JSON.stringify({ eventType: "Delivery", mail: { messageId: "ses-msg-10" } }),
      now,
    );
    expect(event).toMatchObject({ occurredAt: now });
  });

  // The adapter tags every send with its shop (`SES_SHOP_TAG`); the parser
  // reads it back beside the recipient so a complaint can be filed against a
  // person the message id never pointed at.
  it("names the complained-about recipient and the shop the message tag carries", () => {
    const event = parseSesEmailEvent(
      JSON.stringify({
        eventType: "Complaint",
        mail: {
          messageId: "ses-msg-10",
          destination: ["Nora@Example.dive"],
          tags: {
            diveday_shop: ["3f2504e0-4f89-41d3-9a0c-0305e82c3302"],
            diveday_kind: ["last_minute_deal"],
          },
        },
        complaint: { complainedRecipients: [{ emailAddress: " Nora@Example.dive " }] },
      }),
      now,
    );
    expect(event).toMatchObject({
      status: "complained",
      recipient: "nora@example.dive",
      shopId: "3f2504e0-4f89-41d3-9a0c-0305e82c3302",
    });
  });

  it("names the bounced recipient, and falls back to the message's destination", () => {
    expect(
      parseSesEmailEvent(
        JSON.stringify({
          eventType: "Bounce",
          mail: { messageId: "ses-msg-11", destination: ["other@example.dive"] },
          bounce: { bouncedRecipients: [{ emailAddress: "bounced@example.dive" }] },
        }),
        now,
      ),
    ).toMatchObject({ recipient: "bounced@example.dive" });
    expect(
      parseSesEmailEvent(
        JSON.stringify({
          eventType: "Delivery",
          mail: { messageId: "ses-msg-12", destination: ["only@example.dive"] },
        }),
        now,
      ),
    ).toMatchObject({ recipient: "only@example.dive" });
  });

  it("reads a shop tag that is not a uuid as no shop at all", () => {
    const event = parseSesEmailEvent(
      JSON.stringify({
        eventType: "Complaint",
        mail: { messageId: "ses-msg-13", tags: { diveday_shop: ["not-a-shop"] } },
      }),
      now,
    );
    expect(event).toMatchObject({ status: "complained", shopId: null, recipient: null });
  });
});
