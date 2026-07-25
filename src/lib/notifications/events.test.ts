import { describe, expect, it } from "vitest";
import {
  ACTIONABLE_PROVIDER_STATUSES,
  isActionableProviderStatus,
  parseResendEmailEvent,
} from "./events";

const now = new Date("2026-07-24T18:00:00.000Z");

describe("parseResendEmailEvent — delivery events", () => {
  it.each([
    ["email.sent", "sent"],
    ["email.delivered", "delivered"],
    ["email.delivery_delayed", "delivery_delayed"],
    ["email.bounced", "bounced"],
    ["email.complained", "complained"],
    ["email.failed", "failed"],
    ["email.suppressed", "suppressed"],
  ])("maps %s onto the %s provider status", (type, status) => {
    const event = parseResendEmailEvent(
      { type, created_at: "2026-07-24T17:59:00.000Z", data: { email_id: "em_1" } },
      now,
    );
    expect(event).toMatchObject({ kind: "delivery", providerMessageId: "em_1", status });
  });

  it("carries the bounce message so staff see why it bounced", () => {
    const event = parseResendEmailEvent(
      {
        type: "email.bounced",
        created_at: "2026-07-24T17:59:00.000Z",
        data: {
          email_id: "em_1",
          bounce: { type: "Permanent", subType: "General", message: "mailbox unavailable" },
        },
      },
      now,
    );
    expect(event).toMatchObject({ kind: "delivery", detail: "mailbox unavailable" });
  });

  it("falls back to the bounce classification when there's no message", () => {
    const event = parseResendEmailEvent(
      {
        type: "email.bounced",
        data: { email_id: "em_1", bounce: { type: "Permanent", subType: "Suppressed" } },
      },
      now,
    );
    expect(event).toMatchObject({ detail: "Permanent / Suppressed" });
  });

  it("uses the failure reason for a failed send", () => {
    const event = parseResendEmailEvent(
      { type: "email.failed", data: { email_id: "em_1", failed: { reason: "invalid sender" } } },
      now,
    );
    expect(event).toMatchObject({ detail: "invalid sender" });
  });

  it("takes the event's own timestamp over the current clock", () => {
    const event = parseResendEmailEvent(
      { type: "email.delivered", created_at: "2026-07-24T17:00:00.000Z", data: { email_id: "e" } },
      now,
    );
    expect(event).toMatchObject({ occurredAt: new Date("2026-07-24T17:00:00.000Z") });
  });

  it("falls back to now when the event carries no usable timestamp", () => {
    const event = parseResendEmailEvent(
      { type: "email.delivered", created_at: "not a date", data: { email_id: "e" } },
      now,
    );
    expect(event).toMatchObject({ occurredAt: now });
  });

  it("ignores a delivery event with no message id to file it against", () => {
    expect(parseResendEmailEvent({ type: "email.delivered", data: {} }, now)).toEqual({
      kind: "ignored",
    });
  });
});

describe("parseResendEmailEvent — inbound", () => {
  const received = {
    type: "email.received",
    created_at: "2026-07-24T17:58:00.000Z",
    data: {
      email_id: "em_in_1",
      created_at: "2026-07-24T17:57:00.000Z",
      from: "Nora Quinn <nora@gmail.com>",
      to: ["reply+tok@inbound.diveday.example"],
      cc: ["crew@example.com"],
      received_for: ["reply+tok@inbound.diveday.example"],
      subject: "  Re: You're on the boat  ",
    },
  };

  it("reads the sender, every recipient, and a trimmed subject", () => {
    expect(parseResendEmailEvent(received, now)).toEqual({
      kind: "received",
      providerEmailId: "em_in_1",
      from: "Nora Quinn <nora@gmail.com>",
      recipients: [
        "reply+tok@inbound.diveday.example",
        "crew@example.com",
        "reply+tok@inbound.diveday.example",
      ],
      subject: "Re: You're on the boat",
      hasAttachments: false,
      receivedAt: new Date("2026-07-24T17:57:00.000Z"),
    });
  });

  it("flags attachments without recording their content", () => {
    const event = parseResendEmailEvent(
      { ...received, data: { ...received.data, attachments: [{ id: "att_1" }] } },
      now,
    );
    expect(event).toMatchObject({ hasAttachments: true });
  });

  it("treats an empty subject as none", () => {
    const event = parseResendEmailEvent(
      { ...received, data: { ...received.data, subject: "   " } },
      now,
    );
    expect(event).toMatchObject({ subject: null });
  });

  it("ignores an inbound event with no sender", () => {
    const { from: _from, ...withoutSender } = received.data;
    expect(parseResendEmailEvent({ ...received, data: withoutSender }, now)).toEqual({
      kind: "ignored",
    });
  });
});

describe("parseResendEmailEvent — everything else", () => {
  it.each([
    ["email.opened"],
    ["email.clicked"],
    ["domain.created"],
    ["contact.deleted"],
    ["suppression.added"],
  ])("ignores %s so a broadly-subscribed endpoint still answers 200", (type) => {
    expect(parseResendEmailEvent({ type, data: { email_id: "em_1" } }, now)).toEqual({
      kind: "ignored",
    });
  });
});

describe("isActionableProviderStatus", () => {
  it.each(ACTIONABLE_PROVIDER_STATUSES)("treats %s as a shop's problem to chase", (status) => {
    expect(isActionableProviderStatus(status)).toBe(true);
  });

  it.each(["sent", "delivered", "delivery_delayed", "suppressed"] as const)(
    "leaves %s off the issue list",
    (status) => {
      expect(isActionableProviderStatus(status)).toBe(false);
    },
  );

  it("is false when nothing has been reported yet", () => {
    expect(isActionableProviderStatus(null)).toBe(false);
  });
});
