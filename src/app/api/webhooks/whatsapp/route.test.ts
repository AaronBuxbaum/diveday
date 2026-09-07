import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/db/notifications", () => ({ applyProviderEmailEvent: vi.fn() }));
vi.mock("@/db/inbound-messages", () => ({ recordInboundMessage: vi.fn() }));
vi.mock("@/db/whatsapp-accounts", () => ({ shopIdForWhatsAppWaba: vi.fn() }));

const { getDb } = await import("@/db/client");
const { applyProviderEmailEvent } = await import("@/db/notifications");
const { recordInboundMessage } = await import("@/db/inbound-messages");
const { shopIdForWhatsAppWaba } = await import("@/db/whatsapp-accounts");
const { POST } = await import("./route");

const APP_SECRET = "diveday-meta-app-secret";
const FAKE_DB = { fake: "db" };
const SHOP_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";

function sign(payload: string, secret = APP_SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(payload, "utf8").digest("hex")}`;
}

function webhookRequest(payload: string, signature = sign(payload)) {
  return new Request("http://localhost/api/webhooks/whatsapp", {
    method: "POST",
    body: payload,
    headers: { "x-hub-signature-256": signature },
  });
}

function payloadFor(value: Record<string, unknown>, wabaId = "waba-1") {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: wabaId, changes: [{ field: "messages", value }] }],
  });
}

beforeEach(() => {
  vi.stubEnv("META_APP_SECRET", APP_SECRET);
  vi.mocked(getDb).mockResolvedValue(FAKE_DB as never);
  vi.mocked(applyProviderEmailEvent).mockReset().mockResolvedValue("applied");
  vi.mocked(recordInboundMessage)
    .mockReset()
    .mockResolvedValue({ status: "recorded", id: "m1", personId: "p1" });
  vi.mocked(shopIdForWhatsAppWaba).mockReset().mockResolvedValue(SHOP_ID);
});

describe("whatsapp webhook route — inbound messages (ADR 20260907-two-way-inbox)", () => {
  it("files a diver's text against the shop the WABA resolves to", async () => {
    const payload = payloadFor({
      messages: [
        {
          from: "13055551234",
          id: "wamid.in1",
          timestamp: "1785672000",
          type: "text",
          text: { body: "Running late" },
        },
      ],
    });
    const response = await POST(webhookRequest(payload));
    expect(response.status).toBe(200);
    expect(shopIdForWhatsAppWaba).toHaveBeenCalledWith(FAKE_DB, "waba-1");
    expect(recordInboundMessage).toHaveBeenCalledWith(FAKE_DB, {
      shopId: SHOP_ID,
      channel: "whatsapp",
      fromAddress: "13055551234",
      body: "Running late",
      mediaCount: 0,
      receivedAt: new Date(1785672000 * 1000),
      providerMessageId: "wamid.in1",
    });
    expect(applyProviderEmailEvent).not.toHaveBeenCalled();
  });

  it("drops a message for a WABA no shop has connected rather than filing it unscoped", async () => {
    vi.mocked(shopIdForWhatsAppWaba).mockResolvedValue(null);
    const payload = payloadFor({
      messages: [{ from: "13055551234", id: "wamid.in2", type: "text", text: { body: "hi" } }],
    });
    const response = await POST(webhookRequest(payload));
    expect(response.status).toBe(200);
    expect(recordInboundMessage).not.toHaveBeenCalled();
  });

  it("refuses an unsigned or forged payload before touching the database", async () => {
    const payload = payloadFor({
      messages: [{ from: "1", id: "wamid.in3", type: "text", text: { body: "hi" } }],
    });
    expect((await POST(webhookRequest(payload, sign(payload, "wrong")))).status).toBe(400);
    expect((await POST(webhookRequest(payload, ""))).status).toBe(400);
    expect(getDb).not.toHaveBeenCalled();
    expect(recordInboundMessage).not.toHaveBeenCalled();
  });

  it("is unavailable rather than open when no app secret is configured", async () => {
    vi.stubEnv("META_APP_SECRET", "");
    const payload = payloadFor({ messages: [] });
    expect((await POST(webhookRequest(payload))).status).toBe(503);
  });

  it("keeps applying delivery statuses in the same batch as a message", async () => {
    const payload = payloadFor({
      statuses: [{ id: "wamid.out", status: "delivered", timestamp: "1785672000" }],
      messages: [{ from: "13055551234", id: "wamid.in4", type: "text", text: { body: "ok" } }],
    });
    const response = await POST(webhookRequest(payload));
    expect(response.status).toBe(200);
    expect(recordInboundMessage).toHaveBeenCalledTimes(1);
    expect(applyProviderEmailEvent).toHaveBeenCalledWith(FAKE_DB, {
      providerMessageId: "wamid.out",
      status: "delivered",
      detail: null,
      occurredAt: new Date(1785672000 * 1000),
      shopId: SHOP_ID,
    });
    // One lookup for both halves: the WABA is the same.
    expect(shopIdForWhatsAppWaba).toHaveBeenCalledTimes(1);
  });
});
