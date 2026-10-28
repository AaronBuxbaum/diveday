import { describe, expect, it, vi } from "vitest";
import type { CourtesyDelivery } from "./courtesy";
import { sendCourtesyMessage } from "./courtesy";

const courtesy = {
  to: "+13055551234",
  body: "Reef Runner departs Sat at 8:00 AM.",
  shopName: "Blue Horizon Divers",
};
const message = { ...courtesy, smsStopLine: "Reply STOP to opt out." };

function provider(...results: CourtesyDelivery[]) {
  const send = vi.fn();
  for (const result of results) send.mockResolvedValueOnce(result);
  send.mockResolvedValue(results.at(-1) ?? { status: "not_configured" });
  return { send };
}

const sent = (id: string): CourtesyDelivery => ({ status: "sent", providerMessageId: id });

describe("sendCourtesyMessage", () => {
  it("uses SMS when the shop has not connected WhatsApp", async () => {
    const sms = provider(sent("SM_1"));
    const result = await sendCourtesyMessage(message, { sms });

    expect(result).toEqual({ channel: "sms", delivery: sent("SM_1") });
    expect(sms.send).toHaveBeenCalledWith(
      {
        to: message.to,
        body: "Reef Runner departs Sat at 8:00 AM. Reply STOP to opt out.",
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("prefers the shop's WhatsApp when connected", async () => {
    const sms = provider(sent("SM_1"));
    const whatsapp = provider(sent("wamid.1"));
    const result = await sendCourtesyMessage(message, { sms, whatsapp });

    expect(result).toEqual({ channel: "whatsapp", delivery: sent("wamid.1") });
  });

  it("does not also send an SMS when WhatsApp succeeded — the diver gets one message", async () => {
    const sms = provider(sent("SM_1"));
    const whatsapp = provider(sent("wamid.1"));
    await sendCourtesyMessage(message, { sms, whatsapp });

    expect(sms.send).not.toHaveBeenCalled();
  });

  it("passes the shop name to WhatsApp, which needs it as a template variable", async () => {
    const whatsapp = provider(sent("wamid.1"));
    await sendCourtesyMessage(message, { sms: provider(), whatsapp });

    expect(whatsapp.send).toHaveBeenCalledWith(
      courtesy,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("never tells a WhatsApp reader to reply STOP", async () => {
    const whatsapp = provider(sent("wamid.1"));
    await sendCourtesyMessage(
      { ...message, whatsAppBody: "Reef Runner departs Sat. Reply C to confirm." },
      { sms: provider(), whatsapp },
    );

    expect(whatsapp.send).toHaveBeenCalledWith(
      {
        ...courtesy,
        body: "Reef Runner departs Sat. Reply C to confirm.",
        whatsAppBody: "Reef Runner departs Sat. Reply C to confirm.",
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("puts the STOP line on the SMS a failed WhatsApp send falls back to", async () => {
    const sms = provider(sent("SM_1"));
    const whatsapp = provider({ status: "failed", retryable: false, errorCode: "131026" });
    await sendCourtesyMessage(message, { sms, whatsapp });

    expect(sms.send).toHaveBeenCalledWith(
      {
        to: message.to,
        body: "Reef Runner departs Sat at 8:00 AM. Reply STOP to opt out.",
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("falls back to SMS when the diver is not on WhatsApp", async () => {
    const sms = provider(sent("SM_1"));
    const whatsapp = provider({ status: "failed", retryable: false, errorCode: "131026" });
    const result = await sendCourtesyMessage(message, { sms, whatsapp });

    expect(result).toEqual({ channel: "sms", delivery: sent("SM_1") });
    expect(sms.send).toHaveBeenCalledTimes(1);
  });

  it("falls back to SMS even on a retryable WhatsApp failure — the boat leaves either way", async () => {
    const sms = provider(sent("SM_1"));
    const whatsapp = provider({ status: "failed", retryable: true, httpStatus: 503 });
    const result = await sendCourtesyMessage(message, { sms, whatsapp });

    expect(result).toEqual({ channel: "sms", delivery: sent("SM_1") });
  });

  it("gives SMS a fresh bounded signal when WhatsApp times out", async () => {
    vi.useFakeTimers();
    try {
      const whatsapp = {
        send: vi.fn(
          (_message: unknown, options?: { signal?: AbortSignal }) =>
            new Promise<CourtesyDelivery>((resolve) => {
              options?.signal?.addEventListener(
                "abort",
                () => resolve({ status: "failed", retryable: true, errorCode: "timeout" }),
                { once: true },
              );
            }),
        ),
      };
      const sms = {
        send: vi.fn(async (_message: unknown, options?: { signal?: AbortSignal }) => {
          expect(options?.signal?.aborted).toBe(false);
          return sent("SM_after_wa_timeout");
        }),
      };

      const delivery = sendCourtesyMessage(message, { whatsapp, sms });
      await vi.advanceTimersByTimeAsync(2_000);

      await expect(delivery).resolves.toEqual({
        channel: "sms",
        delivery: sent("SM_after_wa_timeout"),
      });
      expect(whatsapp.send.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
      expect(sms.send).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports the SMS failure when both channels fail", async () => {
    const sms = provider({ status: "failed", retryable: true, errorCode: "Throttled" });
    const whatsapp = provider({ status: "failed", retryable: false, errorCode: "190" });
    const result = await sendCourtesyMessage(message, { sms, whatsapp });

    expect(result).toEqual({
      channel: "sms",
      delivery: { status: "failed", retryable: true, errorCode: "Throttled" },
    });
  });

  it("reports the WhatsApp failure when SMS is not configured at all", async () => {
    const sms = provider({ status: "not_configured" });
    const whatsapp = provider({ status: "failed", retryable: false, errorCode: "190" });
    const result = await sendCourtesyMessage(message, { sms, whatsapp });

    expect(result).toEqual({
      channel: "whatsapp",
      delivery: { status: "failed", retryable: false, errorCode: "190" },
    });
  });

  it("reports not_configured when neither channel is set up", async () => {
    const result = await sendCourtesyMessage(message, {
      sms: provider({ status: "not_configured" }),
    });

    expect(result).toEqual({ channel: "sms", delivery: { status: "not_configured" } });
  });

  it("treats an explicit null WhatsApp provider as simply not connected", async () => {
    const sms = provider(sent("SM_1"));
    const result = await sendCourtesyMessage(message, { sms, whatsapp: null });

    expect(result.channel).toBe("sms");
  });
});
