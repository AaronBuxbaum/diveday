import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { shops, shopWhatsappAccounts } from "@/db/schema";
import { nowDate } from "@/lib/clock";
import { describePostgres, postgresTestDb } from "@/test/postgres";
import type { WhatsAppDeliveryEvent } from "./rules";
import { readWhatsAppDeliveredUsage, recordWhatsAppDeliveredUsage } from "./store";

describePostgres("WhatsApp delivered usage concurrent callbacks", () => {
  it("records one unit when two connections deliver the same provider callback", async () => {
    const pg = await postgresTestDb();
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: "Accounting", slug: randomUUID(), timezone: "UTC" })
      .returning();
    const phoneNumberId = randomUUID();
    const now = nowDate();
    await pg.db.insert(shopWhatsappAccounts).values({
      shopId: shop.id,
      phoneNumberId,
      wabaId: "waba",
      accessTokenSealed: "fixture",
      templateName: "fixture",
      templateLanguage: "en_US",
    });
    const event: WhatsAppDeliveryEvent = {
      wabaId: "waba",
      phoneNumberId,
      providerMessageId: "wamid.concurrent",
      status: "delivered",
      detail: null,
      occurredAt: now,
      deliveryTimestampValid: true,
      pricing: { billable: true, model: "PMP", category: "utility", type: "regular" },
    };
    await Promise.all([
      recordWhatsAppDeliveredUsage(pg.connect(), shop.id, event),
      recordWhatsAppDeliveredUsage(pg.connect(), shop.id, event),
    ]);
    expect(
      await readWhatsAppDeliveredUsage(pg.db, {
        shopId: shop.id,
        start: now,
        end: new Date(now.getTime() + 1),
      }),
    ).toEqual([expect.objectContaining({ deliveredMessages: 1 })]);
  });
});
