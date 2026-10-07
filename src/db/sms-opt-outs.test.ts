import { describe, expect, it, vi } from "vitest";
import { unseededTestDb } from "@/test/db";
import {
  clearSmsOptOut,
  isSmsOptedOut,
  recordSmsOptOut,
  stopListedSmsProvider,
} from "./sms-opt-outs";

describe("the SMS stop list", () => {
  it("records a STOP and clears it on START", async () => {
    const db = await unseededTestDb();
    await recordSmsOptOut(db, "+13055550134");
    expect(await isSmsOptedOut(db, "+13055550134")).toBe(true);
    expect(await isSmsOptedOut(db, "+13055550199")).toBe(false);

    await clearSmsOptOut(db, "+13055550134");
    expect(await isSmsOptedOut(db, "+13055550134")).toBe(false);
  });

  it("takes a repeated STOP without error", async () => {
    const db = await unseededTestDb();
    await recordSmsOptOut(db, "+13055550134");
    await recordSmsOptOut(db, "+13055550134");
    expect(await isSmsOptedOut(db, "+13055550134")).toBe(true);
  });

  it("refuses to text a number that replied STOP, without calling the provider", async () => {
    const db = await unseededTestDb();
    await recordSmsOptOut(db, "+13055550134");
    const inner = { send: vi.fn().mockResolvedValue({ status: "sent", providerMessageId: "m" }) };
    const provider = stopListedSmsProvider(db, inner);

    expect(await provider.send({ to: "+13055550134", body: "hi" })).toEqual({
      status: "failed",
      retryable: false,
      errorCode: "opted_out",
    });
    expect(inner.send).not.toHaveBeenCalled();
  });

  it("texts every other number as before", async () => {
    const db = await unseededTestDb();
    await recordSmsOptOut(db, "+13055550134");
    const inner = { send: vi.fn().mockResolvedValue({ status: "sent", providerMessageId: "m" }) };
    const provider = stopListedSmsProvider(db, inner);

    expect(await provider.send({ to: "+13055550199", body: "hi" })).toEqual({
      status: "sent",
      providerMessageId: "m",
    });
  });
});
