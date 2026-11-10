import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { loadShopExportBundleInput } from "@/db/export";
import { shops, shopWhatsappAccounts, whatsAppDeliveredUsage } from "@/db/schema";
import { nowDate } from "@/lib/clock";
import { advanceClock } from "@/test/clock";
import { fileScopedShopContext } from "@/test/db";
import { parseWhatsAppDeliveryEvents } from "./rules";
import { readWhatsAppDeliveredUsage, recordWhatsAppDeliveredUsage } from "./store";

const ctx = fileScopedShopContext();
function event(overrides: Record<string, unknown> = {}) {
  return parseWhatsAppDeliveryEvents(
    JSON.stringify({
      entry: [
        {
          id: "waba",
          changes: [
            {
              value: {
                metadata: { phone_number_id: "pn" },
                statuses: [
                  {
                    id: "wamid.test",
                    status: "delivered",
                    timestamp: String(Math.floor(nowDate().getTime() / 1000)),
                    pricing: {
                      billable: true,
                      pricing_model: "PMP",
                      category: "utility",
                      type: "regular",
                    },
                    recipient_id: "15555550199",
                    ...overrides,
                  },
                ],
              },
            },
          ],
        },
      ],
    }),
    nowDate(),
  )[0];
}
async function account(db: Parameters<typeof recordWhatsAppDeliveredUsage>[0], shopId: string) {
  await db.insert(shopWhatsappAccounts).values({
    shopId,
    phoneNumberId: "pn",
    wabaId: "waba",
    accessTokenSealed: "not-a-secret",
    templateName: "test",
    templateLanguage: "en_US",
  });
}
const window = () => ({
  start: new Date(nowDate().getTime() - 1000),
  end: new Date(nowDate().getTime() + 1000),
});

describe("delivered WhatsApp accounting", () => {
  it("refuses an old delivery replay after its number moves to another shop", async () => {
    const { db, shop } = ctx;
    await account(db, shop.id);
    const old = event();
    await recordWhatsAppDeliveredUsage(db, shop.id, old);
    await db.delete(shopWhatsappAccounts).where(eq(shopWhatsappAccounts.shopId, shop.id));
    advanceClock(10_000);
    const [other] = await db
      .insert(shops)
      .values({ name: "New number owner", slug: "new-number-owner", timezone: "UTC" })
      .returning();
    await account(db, other.id);
    await recordWhatsAppDeliveredUsage(db, other.id, old);
    expect(
      await readWhatsAppDeliveredUsage(db, {
        shopId: other.id,
        start: old.occurredAt,
        end: nowDate(),
      }),
    ).toEqual([]);
  });
  it("counts duplicate deliveries once, records account classification, never invents price or market", async () => {
    const { db, shop } = ctx;
    await account(db, shop.id);
    await recordWhatsAppDeliveredUsage(db, shop.id, event());
    await recordWhatsAppDeliveredUsage(db, shop.id, event());
    const rows = await readWhatsAppDeliveredUsage(db, { shopId: shop.id, ...window() });
    expect(rows).toEqual([
      expect.objectContaining({
        deliveredMessages: 1,
        billable: true,
        category: "utility",
        pricingModel: "PMP",
        wabaId: "waba",
        monetaryCost: null,
        recipientMarket: null,
        invoicePayer: null,
      }),
    ]);
    const persisted = await db.select().from(whatsAppDeliveredUsage);
    expect(JSON.stringify(persisted)).not.toContain("wamid.test");
    expect(JSON.stringify(persisted)).not.toContain("15555550199");
  });
  it("does not count sent, failed, missing timestamps, old replay or a future delivery", async () => {
    const { db, shop } = ctx;
    await account(db, shop.id);
    for (const value of [
      { status: "sent" },
      { status: "failed" },
      { timestamp: undefined },
      { timestamp: "1" },
      { timestamp: "9999999999" },
    ]) {
      await recordWhatsAppDeliveredUsage(db, shop.id, event(value));
    }
    expect(await readWhatsAppDeliveredUsage(db, { shopId: shop.id, ...window() })).toEqual([]);
  });
  it("keeps missing pricing unknown and can enrich it on a duplicate without counting twice", async () => {
    const { db, shop } = ctx;
    await account(db, shop.id);
    await recordWhatsAppDeliveredUsage(db, shop.id, event({ pricing: undefined }));
    expect(await readWhatsAppDeliveredUsage(db, { shopId: shop.id, ...window() })).toEqual([
      expect.objectContaining({ billable: null, category: null }),
    ]);
    await recordWhatsAppDeliveredUsage(
      db,
      shop.id,
      event({
        pricing: {
          billable: false,
          pricing_model: "PMP",
          category: "utility",
          type: "free_customer_service",
        },
      }),
    );
    expect(await readWhatsAppDeliveredUsage(db, { shopId: shop.id, ...window() })).toEqual([
      expect.objectContaining({
        deliveredMessages: 1,
        billable: false,
        pricingType: "free_customer_service",
        monetaryCost: null,
      }),
    ]);
  });
  it("rechecks the number and WABA against the shop and scopes readers", async () => {
    const { db, shop } = ctx;
    await account(db, shop.id);
    const [other] = await db
      .insert(shops)
      .values({ name: "Other", slug: "other-wa", timezone: "UTC" })
      .returning();
    await recordWhatsAppDeliveredUsage(db, other.id, event());
    await recordWhatsAppDeliveredUsage(db, shop.id, { ...event(), wabaId: "other-waba" });
    expect(await db.select().from(whatsAppDeliveredUsage)).toEqual([]);
    await recordWhatsAppDeliveredUsage(db, shop.id, event());
    expect(await readWhatsAppDeliveredUsage(db, { shopId: other.id, ...window() })).toEqual([]);
    await db.delete(shopWhatsappAccounts).where(eq(shopWhatsappAccounts.shopId, shop.id));
    await recordWhatsAppDeliveredUsage(db, shop.id, event({ id: "after-disconnect" }));
    expect(await db.select().from(whatsAppDeliveredUsage)).toHaveLength(1);
  });
  it("exports account evidence only in the owning shop bundle", async () => {
    const { db, shop } = ctx;
    await account(db, shop.id);
    await recordWhatsAppDeliveredUsage(db, shop.id, event());
    const exported = await loadShopExportBundleInput(db, shop.id);
    const usage = exported?.tables.find((table) => table.file === "whatsapp_delivered_usage.csv");
    expect(usage?.rows).toHaveLength(1);
    expect(usage?.header).toContain("billable");
    expect(JSON.stringify(usage)).not.toContain("wamid.test");
    expect(JSON.stringify(usage)).not.toContain("15555550199");
  });
  it("refuses the ambiguous partial second at a new assignment", async () => {
    const { db, shop } = ctx;
    const old = event();
    advanceClock(500);
    await account(db, shop.id);
    await recordWhatsAppDeliveredUsage(db, shop.id, old);
    expect(await readWhatsAppDeliveredUsage(db, { shopId: shop.id, ...window() })).toEqual([]);
    advanceClock(1000);
    await recordWhatsAppDeliveredUsage(db, shop.id, event());
    expect(await readWhatsAppDeliveredUsage(db, { shopId: shop.id, ...window() })).toHaveLength(1);
  });
  it("uses an inclusive start and exclusive end", async () => {
    const { db, shop } = ctx;
    await account(db, shop.id);
    const delivery = event();
    await recordWhatsAppDeliveredUsage(db, shop.id, delivery);
    expect(
      await readWhatsAppDeliveredUsage(db, {
        shopId: shop.id,
        start: delivery.occurredAt,
        end: new Date(delivery.occurredAt.getTime() + 1),
      }),
    ).toHaveLength(1);
    expect(
      await readWhatsAppDeliveredUsage(db, {
        shopId: shop.id,
        start: new Date(delivery.occurredAt.getTime() - 1),
        end: delivery.occurredAt,
      }),
    ).toEqual([]);
  });
});
