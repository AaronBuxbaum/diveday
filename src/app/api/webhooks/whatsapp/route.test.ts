import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/db/notifications", () => ({ applyProviderEmailEvent: vi.fn() }));
vi.mock("@/db/inbound-messages", () => ({ recordInboundMessage: vi.fn() }));
// Stubbed rather than run, for the reason the email route's spec gives: the
// keyword path has its own tests, and what this file owes is the handoff (ADR
// 20260909-reply-keywords).
vi.mock("@/db/reply-keywords", () => ({ handleInboundReplyKeyword: vi.fn() }));
vi.mock("@/db/desk-pings", () => ({ pingDeskAfterHoursSafely: vi.fn() }));
vi.mock("@/db/inbox-assists", () => ({ triageInboundMessagesSafely: vi.fn() }));
// The ping runs after the response (#2311); the test runs what was deferred.
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: vi.fn() };
});
vi.mock("@/db/whatsapp-accounts", () => ({ shopIdForWhatsAppEvent: vi.fn() }));

const { getDb } = await import("@/db/client");
const { applyProviderEmailEvent } = await import("@/db/notifications");
const { recordInboundMessage } = await import("@/db/inbound-messages");
const { handleInboundReplyKeyword } = await import("@/db/reply-keywords");
const { pingDeskAfterHoursSafely } = await import("@/db/desk-pings");
const { after } = await import("next/server");

/** Run whatever the route handed to `after()`, as Next does once it has answered. */
async function runDeferred() {
  for (const [task] of vi.mocked(after).mock.calls) {
    await (typeof task === "function" ? task() : task);
  }
}
const { shopIdForWhatsAppEvent } = await import("@/db/whatsapp-accounts");
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

function payloadFor(value: Record<string, unknown>, wabaId = "waba-1", phoneNumberId = "pn-1") {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: wabaId,
        changes: [
          { field: "messages", value: { metadata: { phone_number_id: phoneNumberId }, ...value } },
        ],
      },
    ],
  });
}

beforeEach(() => {
  vi.stubEnv("META_APP_SECRET", APP_SECRET);
  vi.mocked(getDb).mockResolvedValue(FAKE_DB as never);
  vi.mocked(applyProviderEmailEvent).mockReset().mockResolvedValue("applied");
  vi.mocked(recordInboundMessage)
    .mockReset()
    .mockResolvedValue({ status: "recorded", id: "m1", personId: "p1" });
  vi.mocked(shopIdForWhatsAppEvent).mockReset().mockResolvedValue(SHOP_ID);
  vi.mocked(handleInboundReplyKeyword).mockReset().mockResolvedValue("not_a_keyword");
  vi.mocked(pingDeskAfterHoursSafely).mockReset();
  vi.mocked(after).mockReset();
});

describe("whatsapp webhook route — inbound messages (ADR 20260907-two-way-inbox)", () => {
  it("files a diver's text against the shop its number resolves to", async () => {
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
    expect(shopIdForWhatsAppEvent).toHaveBeenCalledWith(FAKE_DB, {
      phoneNumberId: "pn-1",
      wabaId: "waba-1",
    });
    expect(recordInboundMessage).toHaveBeenCalledWith(FAKE_DB, {
      shopId: SHOP_ID,
      channel: "whatsapp",
      fromAddress: "13055551234",
      body: "Running late",
      mediaCount: 0,
      receivedAt: new Date(1785672000 * 1000),
      providerMessageId: "wamid.in1",
      senderAuthenticated: true,
    });
    // After the webhook has answered (#2311): Meta retries a slow 200 too.
    expect(pingDeskAfterHoursSafely).not.toHaveBeenCalled();
    await runDeferred();
    expect(pingDeskAfterHoursSafely).toHaveBeenCalledWith(FAKE_DB, {
      shopId: SHOP_ID,
      receivedAt: new Date(1785672000 * 1000),
    });
    expect(applyProviderEmailEvent).not.toHaveBeenCalled();
  });

  it("drops a message no shop's number or WABA resolves to rather than filing it unscoped", async () => {
    vi.mocked(shopIdForWhatsAppEvent).mockResolvedValue(null);
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

  /**
   * **Meta retries on any non-2xx and sometimes delivers twice on a 200**, so
   * the keyword path runs only for a row the route actually filed — a `C` read
   * off a redelivery would cancel a seat a second time (ADR
   * 20260909-reply-keywords).
   */
  it("hands a filed message to the keyword path, and a duplicate to nothing", async () => {
    const payload = payloadFor({
      messages: [{ from: "13055551234", id: "wamid.in5", type: "text", text: { body: "C" } }],
    });
    expect((await POST(webhookRequest(payload))).status).toBe(200);
    expect(handleInboundReplyKeyword).toHaveBeenCalledWith(FAKE_DB, {
      shopId: SHOP_ID,
      inboundMessageId: "m1",
    });

    vi.mocked(handleInboundReplyKeyword).mockClear();
    vi.mocked(pingDeskAfterHoursSafely).mockClear();
    vi.mocked(after).mockClear();
    vi.mocked(recordInboundMessage).mockResolvedValue({ status: "duplicate" });
    expect((await POST(webhookRequest(payload))).status).toBe(200);
    expect(handleInboundReplyKeyword).not.toHaveBeenCalled();
    // Nor does a redelivery ping the desk a second time.
    await runDeferred();
    expect(pingDeskAfterHoursSafely).not.toHaveBeenCalled();
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
    // One lookup for both halves: the number and the WABA are the same.
    expect(shopIdForWhatsAppEvent).toHaveBeenCalledTimes(1);
  });

  /**
   * **A delivery status nobody can attribute is dropped, not applied.**
   *
   * `applyProviderEmailEvent` with no `shopId` matches a provider message id
   * across every shop's rows — deliberate for SES, where a bounce genuinely
   * arrives without a tenant, and wrong here, where the WABA is simply absent
   * from the entry. Meta names it on every real event, so failing closed costs
   * nothing and stops one shop's "delivered" landing on another's row
   * (security review, 2026-09-12).
   */
  it("drops a delivery status whose entry names neither a number nor a WABA", async () => {
    const payload = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                statuses: [{ id: "wamid.out", status: "delivered", timestamp: "1785672000" }],
              },
            },
          ],
        },
      ],
    });
    vi.mocked(shopIdForWhatsAppEvent).mockResolvedValue(null);
    expect((await POST(webhookRequest(payload))).status).toBe(200);
    expect(shopIdForWhatsAppEvent).toHaveBeenCalledWith(FAKE_DB, {
      phoneNumberId: null,
      wabaId: null,
    });
    expect(applyProviderEmailEvent).not.toHaveBeenCalled();
  });

  /**
   * **Two shops of one chain share a WABA** (H-20260916-may-dive-chain-share, issue #1767): one delivery
   * can carry changes for both numbers, and each shop gets only its own.
   */
  it("files each message on a shared WABA under the shop its own number belongs to", async () => {
    const NORTH = "11111111-1111-4111-8111-111111111111";
    const SOUTH = "22222222-2222-4222-8222-222222222222";
    vi.mocked(shopIdForWhatsAppEvent).mockImplementation(async (_db, event) =>
      event.phoneNumberId === "pn-north"
        ? NORTH
        : event.phoneNumberId === "pn-south"
          ? SOUTH
          : null,
    );
    const payload = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba-chain",
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "pn-north" },
                messages: [{ from: "1", id: "wamid.n", type: "text", text: { body: "north" } }],
              },
            },
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "pn-south" },
                messages: [{ from: "2", id: "wamid.s", type: "text", text: { body: "south" } }],
                statuses: [{ id: "wamid.out", status: "delivered", timestamp: "1785672000" }],
              },
            },
          ],
        },
      ],
    });
    expect((await POST(webhookRequest(payload))).status).toBe(200);
    const filed = vi
      .mocked(recordInboundMessage)
      .mock.calls.map(([, row]) => [row.body, row.shopId]);
    expect(filed).toEqual([
      ["north", NORTH],
      ["south", SOUTH],
    ]);
    expect(applyProviderEmailEvent).toHaveBeenCalledWith(
      FAKE_DB,
      expect.objectContaining({ providerMessageId: "wamid.out", shopId: SOUTH }),
    );
  });
});
