import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { recordEmailBounces } from "../features/email-bounces/store";
import type { SesBounceReport } from "../features/email-events/rules";
import { recipientSuppressed } from "./send-holds";

const ctx = fileScopedShopContext();

function report(overrides: Partial<SesBounceReport>): SesBounceReport {
  return {
    providerMessageId: "ses-1",
    event: "bounce",
    recipient: "nora@gmail.com",
    bounceType: "Permanent",
    bounceSubType: "General",
    smtpStatus: "550 5.1.1",
    complaintType: null,
    kind: "trip_reminder",
    purpose: null,
    shopId: null,
    sentByPersonId: null,
    occurredAt: new Date("2026-10-20T14:00:00.000Z"),
    ...overrides,
  };
}

describe("recipientSuppressed", () => {
  it("holds an address that bounced for good, whatever its case", async () => {
    await recordEmailBounces(ctx.db, [report({})]);
    expect(await recipientSuppressed(ctx.db, "Nora@Gmail.com ")).toBe(true);
  });

  it("holds an address that complained", async () => {
    await recordEmailBounces(ctx.db, [
      report({ event: "complaint", recipient: "ida@gmail.com", bounceType: null }),
    ]);
    expect(await recipientSuppressed(ctx.db, "ida@gmail.com")).toBe(true);
  });

  it("keeps mailing an address whose mailbox was only full, and strangers", async () => {
    await recordEmailBounces(ctx.db, [
      report({
        recipient: "full@gmail.com",
        bounceType: "Transient",
        bounceSubType: "MailboxFull",
      }),
    ]);
    expect(await recipientSuppressed(ctx.db, "full@gmail.com")).toBe(false);
    expect(await recipientSuppressed(ctx.db, "new@gmail.com")).toBe(false);
  });
});
