import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nowMs } from "@/lib/clock";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/db/notifications", () => ({ applyProviderEmailEvent: vi.fn() }));
vi.mock("@/db/inbound-emails", () => ({
  routeInboundEmail: vi.fn(),
  recordInboundEmail: vi.fn(),
}));
vi.mock("@/lib/notifications/inbound", () => ({ inboundEmailFetcherFromEnvironment: vi.fn() }));

const { getDb } = await import("@/db/client");
const { applyProviderEmailEvent } = await import("@/db/notifications");
const { routeInboundEmail, recordInboundEmail } = await import("@/db/inbound-emails");
const { inboundEmailFetcherFromEnvironment } = await import("@/lib/notifications/inbound");
const { POST } = await import("./route");

const secret = `whsec_${Buffer.from("resend-route-test-key").toString("base64")}`;
const FAKE_DB = { fake: "db" };
const UNROUTED = { mailboxId: null, toEmail: "hllo@dive.day" };

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
  vi.mocked(routeInboundEmail).mockReset().mockResolvedValue(UNROUTED);
  vi.mocked(recordInboundEmail).mockReset().mockResolvedValue({ id: "row_1", duplicate: false });
  vi.mocked(inboundEmailFetcherFromEnvironment).mockReset().mockReturnValue(null);
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
    expect(recordInboundEmail).not.toHaveBeenCalled();
  });
});

describe("resend webhook route — inbound mail", () => {
  const received = {
    type: "email.received",
    created_at: "2026-07-24T18:00:00.000Z",
    data: {
      email_id: "em_in_1",
      from: "Priya Raman <priya@example.com>",
      to: ["hello@dive.day"],
      subject: "Switching from DiveAdmin",
    },
  };

  it("files a message under its mailbox with the body it fetched separately", async () => {
    vi.mocked(inboundEmailFetcherFromEnvironment).mockReturnValue({
      fetchBody: vi.fn().mockResolvedValue({ text: "How much of our diver list comes across?" }),
    });
    vi.mocked(routeInboundEmail).mockResolvedValue({
      mailboxId: "mailbox-1",
      toEmail: "hello@dive.day",
    });

    const response = await POST(webhookRequest(received));

    expect(response.status).toBe(200);
    expect(routeInboundEmail).toHaveBeenCalledWith(FAKE_DB, ["hello@dive.day"]);
    expect(recordInboundEmail).toHaveBeenCalledWith(
      FAKE_DB,
      expect.objectContaining({
        providerEmailId: "em_in_1",
        mailboxId: "mailbox-1",
        toEmail: "hello@dive.day",
        textBody: "How much of our diver list comes across?",
        subject: "Switching from DiveAdmin",
      }),
    );
  });

  it("still files the message when the body fetch fails", async () => {
    vi.mocked(inboundEmailFetcherFromEnvironment).mockReturnValue({
      fetchBody: vi.fn().mockResolvedValue(null),
    });

    const response = await POST(webhookRequest(received));

    expect(response.status).toBe(200);
    expect(recordInboundEmail).toHaveBeenCalledWith(
      FAKE_DB,
      expect.objectContaining({ providerEmailId: "em_in_1", textBody: "" }),
    );
  });

  it("files mail to an address no mailbox claims rather than dropping it", async () => {
    vi.mocked(inboundEmailFetcherFromEnvironment).mockReturnValue({
      fetchBody: vi.fn().mockResolvedValue({ text: "This week in dive retail…" }),
    });

    const response = await POST(webhookRequest(received));

    expect(response.status).toBe(200);
    expect(recordInboundEmail).toHaveBeenCalledWith(
      FAKE_DB,
      expect.objectContaining({ mailboxId: null }),
    );
  });
});
