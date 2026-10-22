import type { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { recordSetupRequest } from "@/db/funnel";
import { setupRequests } from "@/db/schema";
import { SUPPORT_EMAIL } from "@/lib/platform-mail";
import { fileScopedShopContext } from "@/test/db";

vi.mock("@/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db/client")>()),
  getDb: vi.fn(),
}));
vi.mock("@/lib/notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications")>()),
  notificationProviderFromEnvironment: vi.fn(),
}));
const { getDb } = await import("@/db/client");
const { notificationProviderFromEnvironment, sesNotificationProvider } = await import(
  "@/lib/notifications"
);
const { sendSetupRequestReceipt } = await import("./receipt");
const ctx = fileScopedShopContext();
let db: AppDb;
const send = vi.fn();

async function saved(locale = "en-US", email = "Requester@Reef.mail") {
  return recordSetupRequest(db, {
    shopName: "Urgent: pay https://attacker.tld <img src=x>",
    region: "PRIVATE_REGION",
    contactName: "PRIVATE_PERSON",
    phone: "+15555550100",
    runsBoat: true,
    currentSystem: "paper",
    email,
    source: "pricing",
    locale,
    receiptPending: true,
  });
}
beforeEach(() => {
  db = ctx.db;
  vi.mocked(getDb).mockReset().mockResolvedValue(db);
  send.mockReset().mockResolvedValue({ MessageId: "ses-receipt-id" });
  vi.mocked(notificationProviderFromEnvironment)
    .mockReset()
    .mockReturnValue(
      sesNotificationProvider(
        {
          region: "us-east-1",
          from: "DiveDay <notifications@ses.dive.day>",
          accessKeyId: "TEST",
          secretAccessKey: "TEST",
        },
        { client: { send }, maxAttempts: 1 },
      ),
    );
});

describe("requester receipt saved-ID boundary", () => {
  it.each([
    ["en-US", "DiveDay has your setup request", "We’ll write to you to set up your shop."],
    ["es-ES", "DiveDay recibió tu solicitud", "Te escribiremos para abrir tu centro."],
    ["unsupported", "DiveDay has your setup request", "We’ll write to you to set up your shop."],
  ])(
    "renders fixed %s copy and one saved normalized recipient without operator capabilities",
    async (locale, subject, body) => {
      const row = await saved(locale);
      await sendSetupRequestReceipt(row.id);
      await sendSetupRequestReceipt(row.id);
      expect(send).toHaveBeenCalledTimes(1);
      const command = send.mock.calls[0]?.[0] as SendEmailCommand;
      expect(command.input).toMatchObject({
        FromEmailAddress: "DiveDay <notifications@ses.dive.day>",
        Destination: { ToAddresses: ["requester@reef.mail"] },
        ReplyToAddresses: [SUPPORT_EMAIL],
        Content: {
          Simple: {
            Subject: { Data: subject },
            Body: { Text: { Data: expect.stringContaining(body) } },
          },
        },
      });
      const bytes = JSON.stringify(command.input);
      expect(bytes).toContain(SUPPORT_EMAIL);
      expect(bytes).not.toMatch(
        /attacker|PRIVATE_|15555550100|onboarding@|\/onboard|setup=|expires|CcAddresses|BccAddresses|Attachments|setup_request_id/i,
      );
      expect(command.input.Content?.Simple?.Attachments).toBeUndefined();
      expect(command.input.EmailTags).toEqual([
        { Name: "diveday_kind", Value: "setup_request_receipt" },
      ]);
      expect(notificationProviderFromEnvironment).toHaveBeenCalledWith(process.env, {
        maxAttempts: 1,
      });
      expect(await db.select().from(setupRequests)).toMatchObject([
        { receiptStatus: "accepted", receiptProviderMessageId: "ses-receipt-id" },
      ]);
    },
  );

  it.each([
    ["not_configured", { status: "not_configured" }, "failed", "not_configured"],
    [
      "throttle",
      { status: "failed", retryable: true, httpStatus: 429, errorCode: "TooManyRequestsException" },
      "failed",
      "throttled",
    ],
    [
      "5xx",
      { status: "failed", retryable: true, httpStatus: 503 },
      "unknown",
      "provider_unavailable",
    ],
    [
      "timeout",
      { status: "failed", retryable: true, errorCode: "network_error" },
      "unknown",
      "network_error",
    ],
    [
      "missing ID",
      { status: "failed", retryable: true, errorCode: "invalid_response" },
      "unknown",
      "invalid_response",
    ],
    [
      "unsafe ID",
      { status: "sent", providerMessageId: "victim@reef.mail setup=TOKEN" },
      "unknown",
      "invalid_response",
    ],
    [
      "permanent",
      { status: "failed", retryable: false, errorCode: "MessageRejected" },
      "failed",
      "rejected",
    ],
    [
      "arbitrary",
      {
        status: "failed",
        retryable: false,
        errorCode: "victim@reef.mail TOKEN",
        detail: "PRIVATE_PERSON setup=TOKEN",
      },
      "failed",
      "provider_rejected",
    ],
  ])(
    "never automatically retries %s and retains only fixed codes",
    async (_label, delivery, status, errorCode) => {
      const provider = { send: vi.fn().mockResolvedValue(delivery) };
      vi.mocked(notificationProviderFromEnvironment).mockReturnValue(provider);
      const row = await saved();
      await sendSetupRequestReceipt(row.id);
      await sendSetupRequestReceipt(row.id);
      expect(provider.send).toHaveBeenCalledTimes(1);
      expect(await db.select().from(setupRequests)).toMatchObject([
        { receiptStatus: status, receiptProviderMessageId: null, receiptErrorCode: errorCode },
      ]);
    },
  );

  it("swallows exceptions without persisting or logging their name/message and never reclaims", async () => {
    const error = new Error("PRIVATE_PERSON victim@reef.mail setup=TOKEN");
    error.name = "victim@reef.mail TOKEN";
    const provider = { send: vi.fn().mockRejectedValue(error) };
    vi.mocked(notificationProviderFromEnvironment).mockReturnValue(provider);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const row = await saved();
      await sendSetupRequestReceipt(row.id);
      await sendSetupRequestReceipt(row.id);
      expect(provider.send).toHaveBeenCalledTimes(1);
      expect(await db.select().from(setupRequests)).toMatchObject([
        { receiptStatus: "unknown", receiptErrorCode: "send_exception" },
      ]);
      expect(JSON.stringify(warn.mock.calls)).not.toMatch(/PRIVATE_PERSON|victim@|TOKEN/);
    } finally {
      warn.mockRestore();
    }
  });

  it("never sends erased or historical rows, and a duplicate submission saves a second request but suppresses mail", async () => {
    const first = await saved();
    await sendSetupRequestReceipt(first.id);
    const duplicate = await saved();
    await sendSetupRequestReceipt(duplicate.id);
    const old = await recordSetupRequest(db, {
      shopName: "Old",
      region: "Keys",
      contactName: "Old",
      email: "old@reef.mail",
      phone: null,
      runsBoat: false,
      currentSystem: "paper",
      locale: "en-US",
      source: "pricing",
    });
    await sendSetupRequestReceipt(old.id);
    const gone = await saved("en-US", "gone@reef.mail");
    const { deleteSetupRequestsByEmail } = await import("@/db/funnel");
    await deleteSetupRequestsByEmail(db, gone.email);
    await sendSetupRequestReceipt(gone.id);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await db.select().from(setupRequests)).toHaveLength(3);
  });
});
