import { describe, expect, it } from "vitest";
import { parseSesInboundNotification } from "./ses-inbound";

const NOW = new Date("2026-07-21T13:30:00.000Z");

function received(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    notificationType: "Received",
    receipt: {
      timestamp: "2026-07-21T13:00:00.000Z",
      recipients: ["reply+3f2504e0-4f89-41d3-9a0c-0305e82c3301@inbound.ses.dive.day"],
      spamVerdict: { status: "PASS" },
      virusVerdict: { status: "PASS" },
      action: { type: "S3", bucketName: "diveday-inbound-mail", objectKey: "mail/abc123" },
    },
    mail: {
      messageId: "abc123",
      timestamp: "2026-07-21T12:59:58.000Z",
      source: "priya@example.com",
      destination: ["reply+3f2504e0-4f89-41d3-9a0c-0305e82c3301@inbound.ses.dive.day"],
    },
    ...overrides,
  });
}

describe("parseSesInboundNotification", () => {
  it("reads where SES put the message and who it was for", () => {
    expect(parseSesInboundNotification(received(), NOW)).toEqual({
      kind: "received",
      providerMessageId: "abc123",
      bucketName: "diveday-inbound-mail",
      objectKey: "mail/abc123",
      recipients: ["reply+3f2504e0-4f89-41d3-9a0c-0305e82c3301@inbound.ses.dive.day"],
      envelopeFrom: "priya@example.com",
      receivedAt: new Date("2026-07-21T12:59:58.000Z"),
    });
  });

  it("refuses a message the virus scan failed, and keeps one the spam scan failed", () => {
    const virus = received({
      receipt: {
        virusVerdict: { status: "FAIL" },
        action: { type: "S3", bucketName: "b", objectKey: "k" },
      },
    });
    expect(parseSesInboundNotification(virus, NOW)).toEqual({ kind: "ignored", reason: "virus" });
    const spam = received({
      receipt: {
        spamVerdict: { status: "FAIL" },
        action: { type: "S3", bucketName: "b", objectKey: "k" },
      },
    });
    expect(parseSesInboundNotification(spam, NOW).kind).toBe("received");
  });

  it("ignores a delivery event, a non-S3 action, and garbage", () => {
    expect(parseSesInboundNotification(JSON.stringify({ eventType: "Bounce" }), NOW)).toEqual({
      kind: "ignored",
      reason: "not_received",
    });
    expect(
      parseSesInboundNotification(received({ receipt: { action: { type: "SNS" } } }), NOW),
    ).toEqual({ kind: "ignored", reason: "not_s3" });
    expect(parseSesInboundNotification("not json", NOW)).toEqual({
      kind: "ignored",
      reason: "malformed",
    });
    expect(parseSesInboundNotification(received({ mail: {} }), NOW)).toEqual({
      kind: "ignored",
      reason: "malformed",
    });
  });

  it("falls back to now when neither timestamp parses", () => {
    const result = parseSesInboundNotification(
      received({
        receipt: { action: { type: "S3", bucketName: "b", objectKey: "k" }, timestamp: "nope" },
        mail: { messageId: "m", timestamp: "also nope" },
      }),
      NOW,
    );
    expect(result).toMatchObject({ kind: "received", receivedAt: NOW, recipients: [] });
  });
});
