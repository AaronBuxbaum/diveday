import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/db/notifications", () => ({ applyProviderEmailEvent: vi.fn() }));
vi.mock("@/lib/notifications/sns", () => ({
  verifySnsMessage: vi.fn(),
  confirmSnsSubscription: vi.fn(),
}));

const { getDb } = await import("@/db/client");
const { applyProviderEmailEvent } = await import("@/db/notifications");
const { verifySnsMessage, confirmSnsSubscription } = await import("@/lib/notifications/sns");
const { POST } = await import("./route");

const FAKE_DB = { fake: "db" };

function webhookRequest(body: string) {
  return new Request("http://localhost/api/webhooks/ses", { method: "POST", body });
}

beforeEach(() => {
  vi.stubEnv("SES_SNS_TOPIC_ARN", "arn:aws:sns:us-east-1:123456789012:diveday-ses-email-events");
  vi.mocked(getDb).mockResolvedValue(FAKE_DB as never);
  vi.mocked(applyProviderEmailEvent).mockReset().mockResolvedValue("applied");
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
