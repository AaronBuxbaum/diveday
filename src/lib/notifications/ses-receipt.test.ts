import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ constructors: vi.fn(), send: vi.fn() }));
vi.mock("@aws-sdk/client-sesv2", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@aws-sdk/client-sesv2")>()),
  SESv2Client: class {
    constructor(options: unknown) {
      sdk.constructors(options);
    }
    send = sdk.send;
  },
}));
const { notify, sesNotificationProvider } = await import("./index");
const { notificationIsQueueable } = await import("./kinds");
const { shopVoiceOf } = await import("./shop-voice");
const config = {
  region: "us-east-1",
  from: "Fork <fork@ses.dive.day>",
  accessKeyId: "TEST",
  secretAccessKey: "TEST",
};
const receipt = {
  kind: "setup_request_receipt" as const,
  setupRequestId: "00000000-0000-4000-8000-000000000001",
  to: "requester@reef.mail",
  locale: "en-US" as const,
};
beforeEach(() => {
  sdk.constructors.mockClear();
  sdk.send.mockReset().mockResolvedValue({ MessageId: "ses-accepted" });
});

describe("receipt-only SES transport", () => {
  it("uses one SDK wire attempt for receipts and preserves other callers' default retries", async () => {
    expect(notificationIsQueueable(receipt)).toBe(false);
    expect(shopVoiceOf(receipt)).toBeNull();
    sesNotificationProvider(config);
    const provider = sesNotificationProvider(config, { maxAttempts: 1 });
    expect(sdk.constructors.mock.calls[0]?.[0]).not.toHaveProperty("maxAttempts");
    expect(sdk.constructors.mock.calls[1]?.[0]).toMatchObject({ maxAttempts: 1 });
    await notify(receipt, provider);
    expect(sdk.send).toHaveBeenCalledTimes(1);
  });

  it("ignores sender overrides for a receipt and strips arbitrary request fields before rendering", async () => {
    await notify(
      {
        ...receipt,
        shopName: "PRIVATE SHOP",
        setupUrl: "https://dive.day/onboard?setup=TOKEN",
        sender: { replyTo: "private@operator.mail", demoShop: true },
      } as typeof receipt,
      sesNotificationProvider(config, { maxAttempts: 1 }),
    );
    const command = sdk.send.mock.calls[0]?.[0];
    expect(command.input).toMatchObject({
      FromEmailAddress: "DiveDay <notifications@ses.dive.day>",
      Destination: { ToAddresses: [receipt.to] },
      ReplyToAddresses: ["support@dive.day"],
    });
    expect(JSON.stringify(command.input)).not.toMatch(/PRIVATE|TOKEN|operator.mail|simulator/);
  });

  it.each([
    [
      "timeout",
      Object.assign(new Error("victim@reef.mail setup=TOKEN"), { name: "victim@reef.mail TOKEN" }),
      "network_error",
    ],
    [
      "AWS failure",
      Object.assign(new Error("victim@reef.mail setup=TOKEN"), {
        name: "victim@reef.mail TOKEN",
        $metadata: { httpStatusCode: 503 },
      }),
      "provider_unavailable",
    ],
    [
      "rejection",
      Object.assign(new Error("victim@reef.mail setup=TOKEN"), {
        name: "MessageRejected",
        $metadata: { httpStatusCode: 400 },
      }),
      "rejected",
    ],
  ])("exposes only a fixed safe code for %s", async (_label, error, errorCode) => {
    sdk.send.mockRejectedValue(error);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await notify(receipt, sesNotificationProvider(config, { maxAttempts: 1 }));
      expect(result).toMatchObject({ status: "failed", errorCode });
      expect(JSON.stringify([result, warn.mock.calls])).not.toMatch(/victim@|TOKEN/);
      expect(sdk.send).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});
