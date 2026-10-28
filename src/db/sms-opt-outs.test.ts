import { describe, expect, it, vi } from "vitest";
import { sendCourtesyMessage } from "@/lib/notifications/courtesy";
import { unseededTestDb } from "@/test/db";
import { isSmsOptedOut, recordSmsKeyword, stopListedSmsProvider } from "./sms-opt-outs";

const PHONE = "+13055550134";
const at = (minute: number) => new Date(Date.UTC(2026, 9, 7, 12, minute));

describe("the SMS stop list", () => {
  it("records a STOP and clears it on a later START", async () => {
    const db = await unseededTestDb();
    await recordSmsKeyword(db, { phone: PHONE, optedOut: true, keywordAt: at(1) });
    expect(await isSmsOptedOut(db, PHONE)).toBe(true);
    expect(await isSmsOptedOut(db, "+13055550199")).toBe(false);

    await recordSmsKeyword(db, { phone: PHONE, optedOut: false, keywordAt: at(2) });
    expect(await isSmsOptedOut(db, PHONE)).toBe(false);
  });

  it("keeps a STOP when an older START is delivered after it", async () => {
    const db = await unseededTestDb();
    await recordSmsKeyword(db, { phone: PHONE, optedOut: true, keywordAt: at(5) });
    await recordSmsKeyword(db, { phone: PHONE, optedOut: false, keywordAt: at(4) });
    expect(await isSmsOptedOut(db, PHONE)).toBe(true);
  });

  it("takes a redelivered STOP without error", async () => {
    const db = await unseededTestDb();
    await recordSmsKeyword(db, { phone: PHONE, optedOut: true, keywordAt: at(1) });
    await recordSmsKeyword(db, { phone: PHONE, optedOut: true, keywordAt: at(1) });
    expect(await isSmsOptedOut(db, PHONE)).toBe(true);
  });

  it("refuses to text a number that replied STOP, without calling the provider", async () => {
    const db = await unseededTestDb();
    await recordSmsKeyword(db, { phone: PHONE, optedOut: true, keywordAt: at(1) });
    const inner = { send: vi.fn().mockResolvedValue({ status: "sent", providerMessageId: "m" }) };
    const provider = stopListedSmsProvider(db, inner);

    expect(await provider.send({ to: PHONE, body: "hi" })).toEqual({
      status: "failed",
      retryable: false,
      errorCode: "opted_out",
    });
    expect(inner.send).not.toHaveBeenCalled();
  });

  it("texts every other number, and one that replied START, as before", async () => {
    const db = await unseededTestDb();
    await recordSmsKeyword(db, { phone: PHONE, optedOut: true, keywordAt: at(1) });
    await recordSmsKeyword(db, { phone: PHONE, optedOut: false, keywordAt: at(2) });
    const inner = { send: vi.fn().mockResolvedValue({ status: "sent", providerMessageId: "m" }) };
    const provider = stopListedSmsProvider(db, inner);

    for (const to of [PHONE, "+13055550199"]) {
      expect(await provider.send({ to, body: "hi" })).toEqual({
        status: "sent",
        providerMessageId: "m",
      });
    }
  });

  it("forwards the bounded abort signal through the stop-list wrapper", async () => {
    const db = await unseededTestDb();
    const controller = new AbortController();
    const inner = { send: vi.fn().mockResolvedValue({ status: "sent", providerMessageId: "m" }) };
    const provider = stopListedSmsProvider(db, inner);

    await provider.send({ to: PHONE, body: "hi" }, { signal: controller.signal });

    expect(inner.send).toHaveBeenCalledWith(
      { to: PHONE, body: "hi" },
      { signal: controller.signal },
    );
  });

  it("uses healthy SMS after an aborted WhatsApp attempt through the stop-list wrapper", async () => {
    const db = await unseededTestDb();
    const smsSend = vi.fn(async (_message: unknown, options?: { signal?: AbortSignal }) => {
      expect(options?.signal?.aborted).toBe(false);
      return { status: "sent" as const, providerMessageId: "sms-fallback" };
    });
    const sms = stopListedSmsProvider(db, {
      send: smsSend,
    });
    const whatsapp = {
      send: vi.fn(async (_message, options?: { signal?: AbortSignal }) => {
        options?.signal?.throwIfAborted();
        return { status: "failed" as const, retryable: true, errorCode: "timeout" };
      }),
    };
    const result = await sendCourtesyMessage(
      { to: PHONE, body: "hi", smsStopLine: "Reply STOP to opt out.", shopName: "DiveDay" },
      { sms, whatsapp },
    );

    expect(result).toMatchObject({ channel: "sms", delivery: { status: "sent" } });
    expect(whatsapp.send).toHaveBeenCalledOnce();
    expect(smsSend).toHaveBeenCalledOnce();
  });
});
