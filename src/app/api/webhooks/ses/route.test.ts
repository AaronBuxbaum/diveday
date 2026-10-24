import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/db/notifications", () => ({ applyProviderEmailEvent: vi.fn() }));
vi.mock("@/db/courtesy-email", () => ({ optOutAddressAfterComplaint: vi.fn() }));
vi.mock("@/db/email-bounces", () => ({ recordEmailBounces: vi.fn() }));
vi.mock("@/db/bookkeeper", () => ({ recordBookkeeperDeliveryOutcome: vi.fn() }));
vi.mock("@/lib/notifications/sns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications/sns")>();
  return { ...actual, verifySnsMessage: vi.fn(), confirmSnsSubscription: vi.fn() };
});

const { getDb } = await import("@/db/client");
const { applyProviderEmailEvent } = await import("@/db/notifications");
const { optOutAddressAfterComplaint } = await import("@/db/courtesy-email");
const { recordEmailBounces } = await import("@/db/email-bounces");
const { recordBookkeeperDeliveryOutcome } = await import("@/db/bookkeeper");
const { verifySnsMessage, confirmSnsSubscription } = await import("@/lib/notifications/sns");
const { POST } = await import("./route");
const { forgetWebhookRefusalReports } = await import("@/lib/webhook-refusal");

const FAKE_DB = { fake: "db" };

function webhookRequest(body: string) {
  return new Request("http://localhost/api/webhooks/ses", { method: "POST", body });
}

beforeEach(() => {
  vi.stubEnv("SES_SNS_TOPIC_ARN", "arn:aws:sns:us-east-1:123456789012:diveday-ses-email-events");
  vi.mocked(getDb).mockResolvedValue(FAKE_DB as never);
  vi.mocked(applyProviderEmailEvent).mockReset().mockResolvedValue("applied");
  vi.mocked(optOutAddressAfterComplaint)
    .mockReset()
    .mockResolvedValue({ people: 1, listEntries: 0 });
  vi.mocked(recordEmailBounces).mockReset().mockResolvedValue(1);
  vi.mocked(recordBookkeeperDeliveryOutcome).mockReset().mockResolvedValue("unchanged");
  vi.mocked(verifySnsMessage).mockReset();
  vi.mocked(confirmSnsSubscription).mockReset();
});

describe("ses webhook route — verification gate", () => {
  it("is unavailable when the topic isn't configured", async () => {
    vi.mocked(verifySnsMessage).mockResolvedValue({ status: "not_configured" });
    const response = await POST(webhookRequest("{}"));
    expect(response.status).toBe(503);
    expect(applyProviderEmailEvent).not.toHaveBeenCalled();
  });

  it("rejects an oversized payload before ever calling verifySnsMessage", async () => {
    const response = await POST(webhookRequest("x".repeat(300_000)));
    expect(response.status).toBe(400);
    expect(verifySnsMessage).not.toHaveBeenCalled();
  });

  it("rejects a malformed payload", async () => {
    vi.mocked(verifySnsMessage).mockResolvedValue({ status: "malformed" });
    const response = await POST(webhookRequest("not json"));
    expect(response.status).toBe(400);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature", async () => {
    vi.mocked(verifySnsMessage).mockResolvedValue({ status: "invalid_signature" });
    const response = await POST(webhookRequest("{}"));
    expect(response.status).toBe(400);
    expect(applyProviderEmailEvent).not.toHaveBeenCalled();
  });

  it("logs a missing topic as webhook.unconfigured and a bad signature as webhook.refused", async () => {
    forgetWebhookRefusalReports();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(verifySnsMessage).mockResolvedValueOnce({ status: "not_configured" });
    await POST(webhookRequest("{}"));
    vi.mocked(verifySnsMessage).mockResolvedValueOnce({ status: "invalid_signature" });
    await POST(webhookRequest("{}"));
    const parse = (spy: typeof warn) => spy.mock.calls.map((call) => JSON.parse(String(call[0])));
    const warned = parse(warn);
    const errored = parse(error);
    warn.mockRestore();
    error.mockRestore();
    expect(errored).toContainEqual(
      expect.objectContaining({ event: "webhook.unconfigured", webhook: "ses" }),
    );
    expect(warned).toEqual([
      expect.objectContaining({
        event: "webhook.refused",
        webhook: "ses",
        reason: "invalid_signature",
      }),
    ]);
  });

  it("rejects a message from an unexpected topic", async () => {
    vi.mocked(verifySnsMessage).mockResolvedValue({ status: "invalid_topic" });
    const response = await POST(webhookRequest("{}"));
    expect(response.status).toBe(400);
    expect(applyProviderEmailEvent).not.toHaveBeenCalled();
  });
});

describe("ses webhook route — subscription handshake", () => {
  it("confirms a verified SubscriptionConfirmation via its SubscribeURL", async () => {
    vi.mocked(verifySnsMessage).mockResolvedValue({
      status: "verified",
      message: {
        Type: "SubscriptionConfirmation",
        MessageId: "m1",
        TopicArn: "t",
        Message: "You have chosen to subscribe...",
        Timestamp: "2026-08-02T18:00:00.000Z",
        SignatureVersion: "1",
        Signature: "sig",
        SigningCertURL: "https://sns.us-east-1.amazonaws.com/cert.pem",
        SubscribeURL: "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription",
        Token: "tok",
      },
    });
    vi.mocked(confirmSnsSubscription).mockResolvedValue(true);

    const response = await POST(webhookRequest("{}"));
    expect(response.status).toBe(200);
    expect(confirmSnsSubscription).toHaveBeenCalledWith(
      "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription",
    );
    expect(applyProviderEmailEvent).not.toHaveBeenCalled();
  });
});

describe("ses webhook route — delivery events", () => {
  function verifiedNotification(message: string) {
    return {
      status: "verified" as const,
      message: {
        Type: "Notification" as const,
        MessageId: "m1",
        TopicArn: "t",
        Message: message,
        Timestamp: "2026-08-02T18:00:00.000Z",
        SignatureVersion: "1",
        Signature: "sig",
        SigningCertURL: "https://sns.us-east-1.amazonaws.com/cert.pem",
      },
    };
  }

  it("files a bounce against the message it belongs to", async () => {
    vi.mocked(verifySnsMessage).mockResolvedValue(
      verifiedNotification(
        JSON.stringify({
          eventType: "Bounce",
          mail: { messageId: "ses_1" },
          bounce: { timestamp: "2026-08-02T18:00:00.000Z", bounceType: "Permanent" },
        }),
      ),
    );

    const response = await POST(webhookRequest("{}"));
    expect(response.status).toBe(200);
    expect(applyProviderEmailEvent).toHaveBeenCalledWith(FAKE_DB, {
      providerMessageId: "ses_1",
      status: "bounced",
      detail: "Permanent",
      occurredAt: new Date("2026-08-02T18:00:00.000Z"),
    });
  });

  it("opts a complainant out of the shop's courtesy mail, by the address and shop the event names", async () => {
    vi.mocked(verifySnsMessage).mockResolvedValue(
      verifiedNotification(
        JSON.stringify({
          eventType: "Complaint",
          mail: {
            messageId: "ses_2",
            tags: { diveday_shop: ["3f2504e0-4f89-41d3-9a0c-0305e82c3302"] },
          },
          complaint: {
            timestamp: "2026-08-02T18:00:00.000Z",
            complaintFeedbackType: "abuse",
            complainedRecipients: [{ emailAddress: "nora@example.dive" }],
          },
        }),
      ),
    );

    const response = await POST(webhookRequest("{}"));
    expect(response.status).toBe(200);
    expect(applyProviderEmailEvent).toHaveBeenCalledWith(
      FAKE_DB,
      expect.objectContaining({ providerMessageId: "ses_2", status: "complained" }),
    );
    expect(optOutAddressAfterComplaint).toHaveBeenCalledWith(FAKE_DB, {
      shopId: "3f2504e0-4f89-41d3-9a0c-0305e82c3302",
      email: "nora@example.dive",
      now: new Date("2026-08-02T18:00:00.000Z"),
    });
  });

  it("files a bounce, but never opts anyone out for one", async () => {
    vi.mocked(verifySnsMessage).mockResolvedValue(
      verifiedNotification(
        JSON.stringify({
          eventType: "Bounce",
          mail: {
            messageId: "ses_3",
            tags: { diveday_shop: ["3f2504e0-4f89-41d3-9a0c-0305e82c3302"] },
          },
          bounce: {
            bounceType: "Permanent",
            bouncedRecipients: [{ emailAddress: "x@example.dive" }],
          },
        }),
      ),
    );

    await POST(webhookRequest("{}"));
    expect(applyProviderEmailEvent).toHaveBeenCalledTimes(1);
    expect(optOutAddressAfterComplaint).not.toHaveBeenCalled();
  });

  it("keeps the bounce per address with its shop, kind and sender, and logs no address", async () => {
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(verifySnsMessage).mockResolvedValue(
      verifiedNotification(
        JSON.stringify({
          eventType: "Bounce",
          mail: {
            messageId: "ses_5",
            tags: {
              diveday_shop: ["3f2504e0-4f89-41d3-9a0c-0305e82c3302"],
              diveday_kind: ["waiver_request"],
              diveday_sender: ["7c9e6679-7425-40de-944b-e07fc1f90ae7"],
            },
          },
          bounce: {
            timestamp: "2026-08-02T18:00:00.000Z",
            bounceType: "Transient",
            bounceSubType: "MailboxFull",
            bouncedRecipients: [
              { emailAddress: "Nora@Example.dive", diagnosticCode: "smtp; 452 4.2.2 full" },
            ],
          },
        }),
      ),
    );

    // An untracked message is still kept: the courtesy kinds record no id.
    vi.mocked(applyProviderEmailEvent).mockResolvedValue("unknown_message");
    const response = await POST(webhookRequest("{}"));
    const lines = info.mock.calls.map((call) => String(call[0]));
    info.mockRestore();
    expect(response.status).toBe(200);
    expect(recordEmailBounces).toHaveBeenCalledWith(FAKE_DB, [
      {
        providerMessageId: "ses_5",
        event: "bounce",
        recipient: "nora@example.dive",
        bounceType: "Transient",
        bounceSubType: "MailboxFull",
        smtpStatus: "452 4.2.2",
        complaintType: null,
        kind: "waiver_request",
        purpose: null,
        shopId: "3f2504e0-4f89-41d3-9a0c-0305e82c3302",
        sentByPersonId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
        occurredAt: new Date("2026-08-02T18:00:00.000Z"),
      },
    ]);
    const recorded = lines
      .map((line) => JSON.parse(line))
      .find((line) => line.event === "ses_webhook.bounce_recorded");
    expect(recorded).toMatchObject({ kind: "waiver_request", recipientDomain: "example.dive" });
    expect(lines.join("\n")).not.toContain("nora@");
  });

  it("keeps nothing for a delivery", async () => {
    vi.mocked(verifySnsMessage).mockResolvedValue(
      verifiedNotification(
        JSON.stringify({
          eventType: "Delivery",
          mail: { messageId: "ses_6", destination: ["nora@example.dive"] },
          delivery: { timestamp: "2026-08-02T18:00:00.000Z" },
        }),
      ),
    );
    await POST(webhookRequest("{}"));
    expect(recordEmailBounces).not.toHaveBeenCalled();
  });

  describe("a month-end send to the bookkeeper (issue #2798)", () => {
    const SHOP = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
    const monthEnd = (event: Record<string, unknown>, kind = "bookkeeper_month_end") =>
      verifiedNotification(
        JSON.stringify({
          mail: {
            messageId: "ses_books",
            destination: ["Books@Example.dive"],
            tags: { diveday_shop: [SHOP], diveday_kind: [kind] },
          },
          ...event,
        }),
      );

    it("records a permanent bounce on the shop the tag names, and logs no address", async () => {
      const info = vi.spyOn(console, "log").mockImplementation(() => {});
      vi.mocked(recordBookkeeperDeliveryOutcome).mockResolvedValue("bounced");
      vi.mocked(verifySnsMessage).mockResolvedValue(
        monthEnd({
          eventType: "Bounce",
          bounce: {
            timestamp: "2026-11-02T14:00:00.000Z",
            bounceType: "Permanent",
            bounceSubType: "General",
            bouncedRecipients: [
              { emailAddress: "Books@Example.dive", diagnosticCode: "smtp; 550 5.1.1 <books@>" },
            ],
          },
        }),
      );
      const response = await POST(webhookRequest("{}"));
      const lines = info.mock.calls.map((call) => String(call[0]));
      info.mockRestore();
      expect(response.status).toBe(200);
      expect(recordBookkeeperDeliveryOutcome).toHaveBeenCalledWith(FAKE_DB, {
        shopId: SHOP,
        recipient: "books@example.dive",
        outcome: "bounced",
        at: new Date("2026-11-02T14:00:00.000Z"),
      });
      const line = lines
        .map((raw) => JSON.parse(raw))
        .find((parsed) => parsed.event === "ses_webhook.bookkeeper_outcome");
      expect(line).toMatchObject({ shopId: SHOP, outcome: "bounced", result: "bounced" });
      expect(lines.join("\n").toLowerCase()).not.toContain("books@");
    });

    it("reads an address on the suppression list as a bounce", async () => {
      vi.mocked(verifySnsMessage).mockResolvedValue(
        monthEnd({
          eventType: "Bounce",
          bounce: { bounceType: "Permanent", bounceSubType: "OnAccountSuppressionList" },
        }),
      );
      await POST(webhookRequest("{}"));
      expect(recordBookkeeperDeliveryOutcome).toHaveBeenCalledWith(
        FAKE_DB,
        expect.objectContaining({ recipient: "books@example.dive", outcome: "bounced" }),
      );
    });

    it("records a delivery, which clears an earlier bounce", async () => {
      vi.mocked(verifySnsMessage).mockResolvedValue(
        monthEnd({ eventType: "Delivery", delivery: { timestamp: "2026-12-02T14:00:00.000Z" } }),
      );
      await POST(webhookRequest("{}"));
      expect(recordBookkeeperDeliveryOutcome).toHaveBeenCalledWith(FAKE_DB, {
        shopId: SHOP,
        recipient: "books@example.dive",
        outcome: "delivered",
        at: new Date("2026-12-02T14:00:00.000Z"),
      });
    });

    it("ignores a full mailbox, a complaint, and any other kind's bounce", async () => {
      for (const message of [
        monthEnd({ eventType: "Bounce", bounce: { bounceType: "Transient" } }),
        monthEnd({
          eventType: "Complaint",
          complaint: { complainedRecipients: [{ emailAddress: "books@example.dive" }] },
        }),
        monthEnd({ eventType: "Bounce", bounce: { bounceType: "Permanent" } }, "bookkeeper_notice"),
      ]) {
        vi.mocked(verifySnsMessage).mockResolvedValue(message);
        expect((await POST(webhookRequest("{}"))).status).toBe(200);
      }
      expect(recordBookkeeperDeliveryOutcome).not.toHaveBeenCalled();
    });
  });

  it("leaves a complaint on untagged mail to the suppression list alone", async () => {
    vi.mocked(verifySnsMessage).mockResolvedValue(
      verifiedNotification(
        JSON.stringify({
          eventType: "Complaint",
          mail: { messageId: "ses_4" },
          complaint: { complainedRecipients: [{ emailAddress: "nora@example.dive" }] },
        }),
      ),
    );

    const response = await POST(webhookRequest("{}"));
    expect(response.status).toBe(200);
    expect(optOutAddressAfterComplaint).not.toHaveBeenCalled();
  });

  it("answers 200 for a verified event type it doesn't handle (Open)", async () => {
    vi.mocked(verifySnsMessage).mockResolvedValue(
      verifiedNotification(JSON.stringify({ eventType: "Open", mail: { messageId: "ses_1" } })),
    );

    const response = await POST(webhookRequest("{}"));
    expect(response.status).toBe(200);
    expect(applyProviderEmailEvent).not.toHaveBeenCalled();
  });

  it("answers 200 for a message it never tracked, so SNS stops retrying", async () => {
    vi.mocked(applyProviderEmailEvent).mockResolvedValue("unknown_message");
    vi.mocked(verifySnsMessage).mockResolvedValue(
      verifiedNotification(
        JSON.stringify({ eventType: "Delivery", mail: { messageId: "ses_unknown" } }),
      ),
    );

    const response = await POST(webhookRequest("{}"));
    expect(response.status).toBe(200);
  });
});

describe("ses webhook route — structured logging", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.mocked(console.log).mockRestore();
    vi.mocked(console.warn).mockRestore();
  });

  it("logs an applied delivery at info level", async () => {
    vi.mocked(verifySnsMessage).mockResolvedValue({
      status: "verified",
      message: {
        Type: "Notification",
        MessageId: "m1",
        TopicArn: "t",
        Message: JSON.stringify({ eventType: "Delivery", mail: { messageId: "ses_applied" } }),
        Timestamp: "2026-08-02T18:00:00.000Z",
        SignatureVersion: "1",
        Signature: "sig",
        SigningCertURL: "https://sns.us-east-1.amazonaws.com/cert.pem",
      },
    });

    await POST(webhookRequest("{}"));

    expect(console.log).toHaveBeenCalledTimes(1);
    const line = JSON.parse(vi.mocked(console.log).mock.calls[0]?.[0] as string);
    expect(line).toEqual(
      expect.objectContaining({
        event: "ses_webhook.delivery_applied",
        providerMessageId: "ses_applied",
        status: "delivered",
        result: "applied",
      }),
    );
  });
});
