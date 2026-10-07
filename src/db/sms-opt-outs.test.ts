import { describe, expect, it, vi } from "vitest";
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
});
