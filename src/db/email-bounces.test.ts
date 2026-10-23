import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { SesBounceReport } from "@/lib/notifications/ses-events";
import { fileScopedShopContext } from "@/test/db";
import { listEmailBounces, recordEmailBounces } from "./email-bounces";
import { emailBounces, people } from "./schema";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

const at = new Date("2026-10-20T14:00:00.000Z");
const week = {
  startsAt: new Date("2026-10-19T00:00:00.000Z"),
  endsAt: new Date("2026-10-26T00:00:00.000Z"),
};

function report(overrides: Partial<SesBounceReport> = {}): SesBounceReport {
  return {
    providerMessageId: "ses-1",
    event: "bounce",
    recipient: "nora@example.com",
    bounceType: "Permanent",
    bounceSubType: "General",
    smtpStatus: "550 5.1.1",
    complaintType: null,
    kind: "waiver_request",
    purpose: null,
    shopId: null,
    sentByPersonId: null,
    occurredAt: at,
    ...overrides,
  };
}

async function staffId(): Promise<{ id: string; fullName: string }> {
  const [person] = await ctx.db
    .select({ id: people.id, fullName: people.fullName })
    .from(people)
    .where(eq(people.shopId, ctx.shop.id))
    .limit(1);
  if (!person) throw new Error("seeded person missing");
  return person;
}

describe("email bounces", () => {
  it("keeps one row per message, recipient and event, however often SNS redelivers it", async () => {
    const { db } = ctx;
    expect(await recordEmailBounces(db, [report(), report({ recipient: "ida@example.com" })])).toBe(
      2,
    );
    expect(await recordEmailBounces(db, [report()])).toBe(0);
    expect(
      await db.select().from(emailBounces).where(eq(emailBounces.providerMessageId, "ses-1")),
    ).toHaveLength(2);
  });

  it("keeps the bounce when its shop or sender tag names no row", async () => {
    const { db } = ctx;
    await recordEmailBounces(db, [
      report({
        shopId: "3f2504e0-4f89-41d3-9a0c-0305e82c3302",
        sentByPersonId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      }),
    ]);
    const [row] = await db
      .select()
      .from(emailBounces)
      .where(eq(emailBounces.providerMessageId, "ses-1"));
    expect(row).toMatchObject({
      shopId: null,
      sentByPersonId: null,
      recipient: "nora@example.com",
    });
  });

  it("lists the week's bounces newest first with the shop and who sent each", async () => {
    const { db, shop } = ctx;
    const sender = await staffId();
    await recordEmailBounces(db, [
      report({ shopId: shop.id, sentByPersonId: sender.id }),
      report({
        providerMessageId: "ses-2",
        event: "complaint",
        complaintType: "abuse",
        occurredAt: new Date("2026-10-21T09:00:00.000Z"),
      }),
      report({ providerMessageId: "ses-old", occurredAt: new Date("2026-10-10T09:00:00.000Z") }),
    ]);
    const listed = await listEmailBounces(db, week);
    expect(listed.total).toBe(2);
    expect(listed.lines.map((line) => line.event)).toEqual(["complaint", "bounce"]);
    expect(listed.lines[1]).toMatchObject({
      recipient: "nora@example.com",
      shopName: shop.name,
      shopSlug: shop.slug,
      sentByName: sender.fullName,
    });
    expect(listed.lines[0]).toMatchObject({ shopName: null, sentByName: null });

    expect((await listEmailBounces(db, week, 1)).lines).toHaveLength(1);
  });
});
