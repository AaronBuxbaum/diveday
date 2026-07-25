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

describe("parseResendEmailEvent — everything else", () => {
  it.each([
    ["email.opened"],
    ["email.clicked"],
    // Inbound mail is a hosted mailbox's job, not ours. An endpoint left
    // subscribed to it must still answer 200 rather than retry forever.
    ["email.received"],
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
