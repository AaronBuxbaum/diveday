import { randomUUID } from "node:crypto";
import type { AppDb } from "@/db/client";
import { whatsAppDeliveredUsage } from "@/db/schema";

export async function whatsAppUsageRetentionFixture(
  { db, shop }: { db: AppDb; shop: { id: string } },
  at: Date,
) {
  const [row] = await db
    .insert(whatsAppDeliveredUsage)
    .values({
      shopId: shop.id,
      phoneNumberId: "pn",
      wabaId: "waba",
      messageFingerprint: randomUUID(),
      deliveredAt: at,
    })
    .returning({ id: whatsAppDeliveredUsage.id });
  if (!row) throw new Error("WhatsApp usage fixture insert returned nothing");
  return row.id;
}
