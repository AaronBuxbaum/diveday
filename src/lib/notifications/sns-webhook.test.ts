import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/notifications/sns", () => ({
  readWebhookPayload: vi.fn(),
  verifySnsMessage: vi.fn(),
  confirmSnsSubscription: vi.fn(),
}));

const { readWebhookPayload, verifySnsMessage, confirmSnsSubscription } = await import(
  "@/lib/notifications/sns"
);
const { gateSnsWebhook } = await import("./sns-webhook");

const request = () => new Request("http://localhost/webhook", { method: "POST", body: "{}" });
const notification = {
  Type: "Notification" as const,
  MessageId: "m1",
  TopicArn: "topic",
  Message: "{}",
  Timestamp: "2026-10-30T12:00:00.000Z",
  SignatureVersion: "1",
  Signature: "sig",
  SigningCertURL: "https://sns.us-east-1.amazonaws.com/cert.pem",
};

beforeEach(() => {
  vi.mocked(readWebhookPayload).mockReset().mockResolvedValue("payload");
  vi.mocked(verifySnsMessage).mockReset();
  vi.mocked(confirmSnsSubscription).mockReset();
});

describe("gateSnsWebhook", () => {
  it("rejects an oversized or unreadable body before verification", async () => {
    vi.mocked(readWebhookPayload).mockResolvedValueOnce(null);
    const result = await gateSnsWebhook(request(), "topic", "ses");
    expect(result.kind).toBe("response");
    if (result.kind === "response") expect(result.response.status).toBe(400);
    expect(verifySnsMessage).not.toHaveBeenCalled();
  });

  it.each([
    ["not_configured", 503],
    ["malformed", 400],
    ["invalid_signature", 400],
    ["invalid_topic", 400],
    ["stale", 400],
  ] as const)("maps %s to HTTP %i and records the route refusal", async (status, httpStatus) => {
    vi.mocked(verifySnsMessage).mockResolvedValueOnce({ status });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await gateSnsWebhook(request(), "pinned-topic", "sms");
    expect(readWebhookPayload).toHaveBeenCalled();
    expect(verifySnsMessage).toHaveBeenCalledWith("payload", "pinned-topic");
    expect(result.kind).toBe("response");
    if (result.kind === "response") expect(result.response.status).toBe(httpStatus);
    expect(status === "not_configured" ? error : warn).toHaveBeenCalled();
    expect(confirmSnsSubscription).not.toHaveBeenCalled();
    error.mockRestore();
    warn.mockRestore();
  });

  it.each(["ses", "sms", "email_inbound"] as const)(
    "passes a verified notification through for %s",
    async (webhook) => {
      vi.mocked(verifySnsMessage).mockResolvedValueOnce({
        status: "verified",
        message: notification,
      });
      expect(await gateSnsWebhook(request(), `${webhook}-topic`, webhook)).toEqual({
        kind: "notification",
        message: notification,
      });
      expect(verifySnsMessage).toHaveBeenCalledWith("payload", `${webhook}-topic`);
      expect(confirmSnsSubscription).not.toHaveBeenCalled();
    },
  );

  it.each(["SubscriptionConfirmation", "UnsubscribeConfirmation"] as const)(
    "confirms verified %s messages and acknowledges even when confirmation fails",
    async (type) => {
      vi.mocked(verifySnsMessage).mockResolvedValueOnce({
        status: "verified",
        message: {
          ...notification,
          Type: type,
          SubscribeURL: "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription",
        },
      });
      vi.mocked(confirmSnsSubscription).mockResolvedValueOnce(false);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = await gateSnsWebhook(request(), "topic", "email_inbound");
      expect(result.kind).toBe("response");
      if (result.kind === "response") expect(result.response.status).toBe(200);
      expect(confirmSnsSubscription).toHaveBeenCalledWith(
        "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription",
      );
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('"email_inbound.subscription_confirmation"'),
      );
      warn.mockRestore();
    },
  );

  it.each([
    ["ses", "ses_webhook.subscription_confirmation"],
    ["sms", "sms_webhook.subscription_confirmation"],
    ["email_inbound", "email_inbound.subscription_confirmation"],
  ] as const)("keeps the %s confirmation event name", async (webhook, event) => {
    vi.mocked(verifySnsMessage).mockResolvedValueOnce({
      status: "verified",
      message: {
        ...notification,
        Type: "SubscriptionConfirmation",
        SubscribeURL: "https://sns.us-east-1.amazonaws.com/",
      },
    });
    vi.mocked(confirmSnsSubscription).mockResolvedValueOnce(true);
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    await gateSnsWebhook(request(), "topic", webhook);
    expect(info).toHaveBeenCalledWith(expect.stringContaining(`"${event}"`));
    info.mockRestore();
  });

  it("logs an absent confirmation URL as unconfirmed while acknowledging it", async () => {
    vi.mocked(verifySnsMessage).mockResolvedValueOnce({
      status: "verified",
      message: { ...notification, Type: "SubscriptionConfirmation" },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await gateSnsWebhook(request(), "topic", "ses");
    expect(result.kind).toBe("response");
    if (result.kind === "response") expect(result.response.status).toBe(200);
    expect(confirmSnsSubscription).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('"ses_webhook.subscription_confirmation"'),
    );
    warn.mockRestore();
  });
});
