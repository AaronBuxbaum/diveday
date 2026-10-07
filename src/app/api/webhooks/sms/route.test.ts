import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/db/notifications", () => ({ applyProviderEmailEvent: vi.fn() }));
vi.mock("@/db/sms-opt-outs", () => ({ recordSmsOptOut: vi.fn(), clearSmsOptOut: vi.fn() }));
vi.mock("@/lib/notifications/sns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications/sns")>();
  return { ...actual, verifySnsMessage: vi.fn(), confirmSnsSubscription: vi.fn() };
});

const { getDb } = await import("@/db/client");
const { applyProviderEmailEvent } = await import("@/db/notifications");
const { recordSmsOptOut, clearSmsOptOut } = await import("@/db/sms-opt-outs");
const { verifySnsMessage } = await import("@/lib/notifications/sns");
const { POST } = await import("./route");

const FAKE_DB = { fake: "db" };

function webhookRequest() {
  return new Request("http://localhost/api/webhooks/sms", { method: "POST", body: "{}" });
}

function verified(body: unknown) {
  vi.mocked(verifySnsMessage).mockResolvedValue({
    status: "verified",
    message: {
      Type: "Notification",
      MessageId: "m1",
      TopicArn: "arn:aws:sns:us-east-1:123456789012:diveday-sms-delivery-receipts",
      Message: JSON.stringify(body),
      Timestamp: "2026-10-07T00:00:00.000Z",
      SignatureVersion: "1",
      Signature: "sig",
      SigningCertURL: "https://sns.us-east-1.amazonaws.com/cert.pem",
    },
  });
}

const inbound = (messageBody: string) => ({
  originationNumber: "+13055550134",
  destinationNumber: "+18335550100",
  messageKeyword: "KEYWORD_123456789012",
  messageBody,
  inboundMessageId: "cae173d2-66b9-564c-8309-21f858e9fb84",
});

beforeEach(() => {
  vi.mocked(getDb).mockResolvedValue(FAKE_DB as never);
  vi.mocked(applyProviderEmailEvent).mockReset().mockResolvedValue("applied");
  vi.mocked(recordSmsOptOut).mockReset();
  vi.mocked(clearSmsOptOut).mockReset();
  vi.mocked(verifySnsMessage).mockReset();
});

describe("sms webhook route — replies to the texting number", () => {
  it("puts a number that replied STOP on the stop list", async () => {
    verified(inbound("Stop"));
    const response = await POST(webhookRequest());
    expect(response.status).toBe(200);
    expect(recordSmsOptOut).toHaveBeenCalledWith(FAKE_DB, "+13055550134", expect.any(Date));
    expect(applyProviderEmailEvent).not.toHaveBeenCalled();
  });

  it("takes a number off the stop list when it replies START", async () => {
    verified(inbound("START"));
    const response = await POST(webhookRequest());
    expect(response.status).toBe(200);
    expect(clearSmsOptOut).toHaveBeenCalledWith(FAKE_DB, "+13055550134");
  });

  it("acknowledges HELP and any other reply without changing anything", async () => {
    for (const body of ["HELP", "See you at the dock"]) {
      verified(inbound(body));
      const response = await POST(webhookRequest());
      expect(response.status).toBe(200);
    }
    expect(recordSmsOptOut).not.toHaveBeenCalled();
    expect(clearSmsOptOut).not.toHaveBeenCalled();
    expect(applyProviderEmailEvent).not.toHaveBeenCalled();
  });

  it("refuses an unverified STOP before touching the stop list", async () => {
    vi.mocked(verifySnsMessage).mockResolvedValue({ status: "invalid_signature" });
    const response = await POST(webhookRequest());
    expect(response.status).toBe(400);
    expect(recordSmsOptOut).not.toHaveBeenCalled();
  });

  it("still applies a delivery receipt arriving on the same topic", async () => {
    verified({
      notification: { messageId: "sns-1", timestamp: "2026-10-07 00:00:00.000" },
      delivery: { providerResponse: "Unknown error" },
      status: "FAILURE",
    });
    const response = await POST(webhookRequest());
    expect(response.status).toBe(200);
    expect(applyProviderEmailEvent).toHaveBeenCalledWith(
      FAKE_DB,
      expect.objectContaining({ providerMessageId: "sns-1", status: "failed" }),
    );
  });
});
