import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/db/inbound-messages", () => ({
  recordInboundMessage: vi.fn(),
  shopIdForInboundEmailToken: vi.fn(),
}));
vi.mock("@/lib/notifications/inbound-mail-store", () => ({
  inboundMailStoreFromEnvironment: vi.fn(),
}));
vi.mock("@/lib/notifications/sns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications/sns")>();
  return { ...actual, verifySnsMessage: vi.fn(), confirmSnsSubscription: vi.fn() };
});

const { getDb } = await import("@/db/client");
const { recordInboundMessage, shopIdForInboundEmailToken } = await import("@/db/inbound-messages");
const { inboundMailStoreFromEnvironment } = await import("@/lib/notifications/inbound-mail-store");
const sns = await import("@/lib/notifications/sns");
const { verifySnsMessage, confirmSnsSubscription } = sns;
const { POST } = await import("./route");

const FAKE_DB = { fake: "db" };
const TOPIC = "arn:aws:sns:us-east-1:123456789012:diveday-ses-inbound-mail";
const TOKEN = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const SHOP_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const BUCKET = "diveday-inbound-mail";

const RAW_MESSAGE = [
  "From: Priya Sharma <priya@example.com>",
  `To: reply+${TOKEN}@inbound.ses.dive.day`,
  "Subject: Re: Your Saturday departure",
  "Message-ID: <abc@mail.example.com>",
  "In-Reply-To: <0100019abc-1234@email.amazonses.com>",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Can I switch to the afternoon boat?",
  "",
  "On Sat, Blue Mantis wrote:",
  "> Your seat is confirmed.",
].join("\r\n");

function webhookRequest(body: string) {
  return new Request("http://localhost/api/webhooks/email-inbound", { method: "POST", body });
}

function receivedMessage(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    notificationType: "Received",
    receipt: {
      recipients: [`reply+${TOKEN}@inbound.ses.dive.day`],
      virusVerdict: { status: "PASS" },
      action: { type: "S3", bucketName: BUCKET, objectKey: "mail/ses-id-1" },
      ...((overrides.receipt as object) ?? {}),
    },
    mail: {
      messageId: "ses-id-1",
      timestamp: "2026-07-21T12:59:58.000Z",
      source: "priya@example.com",
      ...((overrides.mail as object) ?? {}),
    },
  });
}

function verifiedNotification(messageBody: string) {
  return {
    status: "verified" as const,
    message: {
      Type: "Notification" as const,
      MessageId: "m1",
      TopicArn: TOPIC,
      Message: messageBody,
      Timestamp: "2026-07-21T13:00:00.000Z",
      SignatureVersion: "1",
      Signature: "sig",
      SigningCertURL: "https://sns.us-east-1.amazonaws.com/cert.pem",
    },
  };
}

const read = vi.fn();

beforeEach(() => {
  vi.stubEnv("EMAIL_INBOUND_SNS_TOPIC_ARN", TOPIC);
  vi.stubEnv("EMAIL_INBOUND_DOMAIN", "inbound.ses.dive.day");
  vi.mocked(getDb)
    .mockReset()
    .mockResolvedValue(FAKE_DB as never);
  vi.mocked(recordInboundMessage)
    .mockReset()
    .mockResolvedValue({ status: "recorded", id: "im1", personId: "p1" });
  vi.mocked(shopIdForInboundEmailToken).mockReset().mockResolvedValue(SHOP_ID);
  read.mockReset().mockResolvedValue({ status: "ok", message: RAW_MESSAGE });
  vi.mocked(inboundMailStoreFromEnvironment)
    .mockReset()
    .mockReturnValue({ bucketName: BUCKET, read });
  vi.mocked(verifySnsMessage).mockReset();
  vi.mocked(confirmSnsSubscription).mockReset();
});

describe("email-inbound webhook — the envelope", () => {
  it("is unavailable when the topic is not configured", async () => {
    vi.mocked(verifySnsMessage).mockResolvedValue({ status: "not_configured" });
    expect((await POST(webhookRequest("{}"))).status).toBe(503);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("refuses a forged envelope through the real verifier, before any read", async () => {
    // The real verifier: a SigningCertURL on a host that is not SNS is refused
    // without ever being fetched, which is the SSRF-and-forgery door in one.
    vi.mocked(verifySnsMessage).mockImplementation((payload, arn) =>
      vi
        .importActual<typeof sns>("@/lib/notifications/sns")
        .then((actual) => actual.verifySnsMessage(payload, arn, vi.fn() as never)),
    );
    const forged = JSON.stringify({
      Type: "Notification",
      MessageId: "m1",
      TopicArn: TOPIC,
      Message: receivedMessage(),
      Timestamp: new Date().toISOString(),
      SignatureVersion: "1",
      Signature: "c2lnbmF0dXJl",
      SigningCertURL: "https://attacker.example/cert.pem",
    });
    expect((await POST(webhookRequest(forged))).status).toBe(400);
    const wrongTopic = JSON.stringify({ ...JSON.parse(forged), TopicArn: "arn:aws:sns:x:y:z" });
    expect((await POST(webhookRequest(wrongTopic))).status).toBe(400);
    expect(read).not.toHaveBeenCalled();
    expect(recordInboundMessage).not.toHaveBeenCalled();
  });

  it("rejects an oversized payload before verifying", async () => {
    expect((await POST(webhookRequest("x".repeat(300_000)))).status).toBe(400);
    expect(verifySnsMessage).not.toHaveBeenCalled();
  });

  it("confirms a verified subscription handshake", async () => {
    vi.mocked(verifySnsMessage).mockResolvedValue({
      status: "verified",
      message: {
        ...verifiedNotification("x").message,
        Type: "SubscriptionConfirmation",
        SubscribeURL: "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription",
        Token: "tok",
      },
    });
    vi.mocked(confirmSnsSubscription).mockResolvedValue(true);
    expect((await POST(webhookRequest("{}"))).status).toBe(200);
    expect(confirmSnsSubscription).toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });
});

describe("email-inbound webhook — filing a reply", () => {
  it("resolves the shop from the reply-to token, reads the message, and files it", async () => {
    vi.mocked(verifySnsMessage).mockResolvedValue(verifiedNotification(receivedMessage()));
    expect((await POST(webhookRequest("{}"))).status).toBe(200);
    expect(shopIdForInboundEmailToken).toHaveBeenCalledWith(FAKE_DB, TOKEN);
    expect(read).toHaveBeenCalledWith("mail/ses-id-1");
    expect(recordInboundMessage).toHaveBeenCalledWith(FAKE_DB, {
      shopId: SHOP_ID,
      channel: "email",
      fromAddress: "Priya Sharma <priya@example.com>",
      subject: "Re: Your Saturday departure",
      body: "Can I switch to the afternoon boat?",
      mediaCount: 0,
      receivedAt: new Date("2026-07-21T12:59:58.000Z"),
      providerMessageId: "ses-id-1",
      emailMessageId: "<abc@mail.example.com>",
      inReplyToProviderMessageId: "0100019abc-1234",
    });
  });

  it("never reads from a bucket the stack did not provision", async () => {
    vi.mocked(verifySnsMessage).mockResolvedValue(
      verifiedNotification(
        receivedMessage({
          receipt: { action: { type: "S3", bucketName: "somebody-elses", objectKey: "k" } },
        }),
      ),
    );
    expect((await POST(webhookRequest("{}"))).status).toBe(200);
    expect(read).not.toHaveBeenCalled();
    expect(recordInboundMessage).not.toHaveBeenCalled();
  });

  it("drops mail for a token no shop holds, and mail with no token at all, without reading", async () => {
    vi.mocked(shopIdForInboundEmailToken).mockResolvedValue(null);
    vi.mocked(verifySnsMessage).mockResolvedValue(verifiedNotification(receivedMessage()));
    expect((await POST(webhookRequest("{}"))).status).toBe(200);
    expect(read).not.toHaveBeenCalled();

    vi.mocked(verifySnsMessage).mockResolvedValue(
      verifiedNotification(receivedMessage({ receipt: { recipients: ["someone@example.com"] } })),
    );
    expect((await POST(webhookRequest("{}"))).status).toBe(200);
    expect(getDb).toHaveBeenCalledTimes(1);
    expect(recordInboundMessage).not.toHaveBeenCalled();
  });

  it("asks SNS to retry when the object cannot be read, and ignores an oversized one", async () => {
    vi.mocked(verifySnsMessage).mockResolvedValue(verifiedNotification(receivedMessage()));
    read.mockResolvedValueOnce({ status: "failed" });
    expect((await POST(webhookRequest("{}"))).status).toBe(500);
    read.mockResolvedValueOnce({ status: "too_large" });
    expect((await POST(webhookRequest("{}"))).status).toBe(200);
    expect(recordInboundMessage).not.toHaveBeenCalled();
  });

  it("ignores a delivery event that reached the wrong topic and a message with nothing in it", async () => {
    vi.mocked(verifySnsMessage).mockResolvedValue(
      verifiedNotification(JSON.stringify({ eventType: "Delivery", mail: { messageId: "x" } })),
    );
    expect((await POST(webhookRequest("{}"))).status).toBe(200);
    expect(read).not.toHaveBeenCalled();

    vi.mocked(verifySnsMessage).mockResolvedValue(verifiedNotification(receivedMessage()));
    read.mockResolvedValueOnce({
      status: "ok",
      message: "From: a@example.com\r\nContent-Type: text/plain\r\n\r\n   ",
    });
    expect((await POST(webhookRequest("{}"))).status).toBe(200);
    expect(recordInboundMessage).not.toHaveBeenCalled();
  });

  it("is unavailable when the bucket credentials are not configured", async () => {
    vi.mocked(inboundMailStoreFromEnvironment).mockReturnValue(null);
    vi.mocked(verifySnsMessage).mockResolvedValue(verifiedNotification(receivedMessage()));
    expect((await POST(webhookRequest("{}"))).status).toBe(503);
  });
});
