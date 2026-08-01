import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nowMs } from "@/lib/clock";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/db/notifications", () => ({ applyProviderEmailEvent: vi.fn() }));

const { getDb } = await import("@/db/client");
const { applyProviderEmailEvent } = await import("@/db/notifications");
const { POST } = await import("./route");

const secret = `whsec_${Buffer.from("resend-route-test-key").toString("base64")}`;
const FAKE_DB = { fake: "db" };

function webhookRequest(
  event: Record<string, unknown>,
  options: { signingSecret?: string; timestamp?: number; signed?: boolean } = {},
) {
  const payload = JSON.stringify(event);
  const id = "msg_1";
  const timestamp = options.timestamp ?? Math.floor(nowMs() / 1000);
  const headers: Record<string, string> = {};
  if (options.signed !== false) {
    const base64 = (options.signingSecret ?? secret).replace(/^whsec_/, "");
    const signature = createHmac("sha256", Buffer.from(base64, "base64"))
      .update(`${id}.${timestamp}.${payload}`)
      .digest("base64");
    headers["svix-id"] = id;
    headers["svix-timestamp"] = String(timestamp);
    headers["svix-signature"] = `v1,${signature}`;
  }
  return new Request("http://localhost/api/webhooks/resend", {
    method: "POST",
    headers,
    body: payload,
  });
}

beforeEach(() => {
  vi.stubEnv("RESEND_WEBHOOK_SECRET", secret);
  vi.mocked(getDb).mockResolvedValue(FAKE_DB as never);
  vi.mocked(applyProviderEmailEvent).mockReset().mockResolvedValue("applied");
});

describe("resend webhook route — signature gate", () => {
  it("is unavailable until a signing secret is configured", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "");
    const response = await POST(webhookRequest({ type: "email.delivered", data: {} }));
    expect(response.status).toBe(503);
    expect(applyProviderEmailEvent).not.toHaveBeenCalled();
  });

  it("rejects an unsigned request without touching the database", async () => {
    const response = await POST(
      webhookRequest({ type: "email.delivered", data: { email_id: "em_1" } }, { signed: false }),
    );
    expect(response.status).toBe(400);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("rejects a request signed with the wrong secret", async () => {
    const response = await POST(
      webhookRequest(
        { type: "email.delivered", data: { email_id: "em_1" } },
        { signingSecret: "whsec_d3Jvbmc=" },
      ),
    );
    expect(response.status).toBe(400);
    expect(applyProviderEmailEvent).not.toHaveBeenCalled();
  });

  it("rejects a replayed event outside the timestamp tolerance", async () => {
    const response = await POST(
      webhookRequest(
        { type: "email.delivered", data: { email_id: "em_1" } },
        { timestamp: Math.floor(nowMs() / 1000) - 10_000 },
      ),
    );
    expect(response.status).toBe(400);
    expect(applyProviderEmailEvent).not.toHaveBeenCalled();
  });
});

describe("resend webhook route — delivery events", () => {
  it("files a bounce against the message it belongs to", async () => {
    const response = await POST(
      webhookRequest({
        type: "email.bounced",
        created_at: "2026-07-24T18:00:00.000Z",
        data: { email_id: "em_1", bounce: { message: "mailbox unavailable" } },
      }),
    );

    expect(response.status).toBe(200);
    expect(applyProviderEmailEvent).toHaveBeenCalledWith(FAKE_DB, {
      providerMessageId: "em_1",
      status: "bounced",
      detail: "mailbox unavailable",
      occurredAt: new Date("2026-07-24T18:00:00.000Z"),
    });
  });

  it("answers 200 for a message it never tracked, so Resend stops retrying", async () => {
    vi.mocked(applyProviderEmailEvent).mockResolvedValue("unknown_message");
    const response = await POST(
      webhookRequest({ type: "email.delivered", data: { email_id: "em_unknown" } }),
    );
    expect(response.status).toBe(200);
  });

  it("answers 200 for a verified event type it doesn't handle", async () => {
    const response = await POST(
      webhookRequest({ type: "email.opened", data: { email_id: "em_1" } }),
    );
    expect(response.status).toBe(200);
    expect(applyProviderEmailEvent).not.toHaveBeenCalled();
  });
});

describe("resend webhook route — structured logging", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.mocked(console.log).mockRestore();
    vi.mocked(console.warn).mockRestore();
  });

  it("logs an applied delivery at info level", async () => {
    vi.mocked(applyProviderEmailEvent).mockResolvedValue("applied");
    await POST(
      webhookRequest({
        type: "email.delivered",
        data: { email_id: "em_applied" },
      }),
    );

    expect(console.log).toHaveBeenCalledTimes(1);
    const line = JSON.parse(vi.mocked(console.log).mock.calls[0]?.[0] as string);
    expect(line).toEqual(
      expect.objectContaining({
        event: "resend_webhook.delivery_applied",
        providerMessageId: "em_applied",
        status: "delivered",
        result: "applied",
      }),
    );
  });

  it("logs an unknown_message delivery at warn level, not info", async () => {
    vi.mocked(applyProviderEmailEvent).mockResolvedValue("unknown_message");
    await POST(
      webhookRequest({
        type: "email.delivered",
        data: { email_id: "em_unknown" },
      }),
    );

    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.log).not.toHaveBeenCalled();
    const line = JSON.parse(vi.mocked(console.warn).mock.calls[0]?.[0] as string);
    expect(line).toEqual(
      expect.objectContaining({
        event: "resend_webhook.delivery_applied",
        result: "unknown_message",
      }),
    );
  });

  it("logs a stale delivery at warn level", async () => {
    vi.mocked(applyProviderEmailEvent).mockResolvedValue("stale");
    await POST(
      webhookRequest({
        type: "email.bounced",
        data: { email_id: "em_stale" },
      }),
    );

    expect(console.warn).toHaveBeenCalledTimes(1);
    const line = JSON.parse(vi.mocked(console.warn).mock.calls[0]?.[0] as string);
    expect(line).toEqual(
      expect.objectContaining({ event: "resend_webhook.delivery_applied", result: "stale" }),
    );
  });
});
