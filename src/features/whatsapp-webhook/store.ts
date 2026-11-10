import { createHash } from "node:crypto";
import { and, count, eq, gte, lt, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { AppDb } from "../../db/client";
import { shopWhatsappAccounts, whatsAppDeliveredUsage } from "../../db/schema";
import { retentionCutoff } from "../retention";
import type { WhatsAppDeliveryEvent } from "./rules";

/** Called only after signature verification. Resolves the account again inside the write,
 * so a disconnected/reassigned number cannot be charged to a cached tenant. No recipient
 * or raw provider message id is retained. A replay can enrich unknown classification,
 * but never create a second chargeable unit or move the original delivery window.
 */
export async function recordWhatsAppDeliveredUsage(
  db: AppDb,
  shopId: string,
  event: WhatsAppDeliveryEvent,
) {
  const now = nowDate();
  if (
    event.status !== "delivered" ||
    !event.deliveryTimestampValid ||
    !event.phoneNumberId ||
    !event.wabaId ||
    event.occurredAt < retentionCutoff("whatsapp_delivered_usage", now) ||
    event.occurredAt > now
  )
    return;
  const messageFingerprint = createHash("sha256")
    .update(JSON.stringify([shopId, event.phoneNumberId, event.providerMessageId]))
    .digest("hex");
  // INSERT ... SELECT binds account ownership and the ledger write in one statement.
  await db
    .insert(whatsAppDeliveredUsage)
    .select(
      db
        .select({
          shopId: shopWhatsappAccounts.shopId,
          phoneNumberId: shopWhatsappAccounts.phoneNumberId,
          wabaId: sql<string>`${shopWhatsappAccounts.wabaId}`.as("waba_id"),
          messageFingerprint: sql<string>`${messageFingerprint}`.as("message_fingerprint"),
          deliveredAt: sql<Date>`${event.occurredAt.toISOString()}::timestamptz`.as("delivered_at"),
          pricingModel: sql<string | null>`${event.pricing?.model ?? null}`.as("pricing_model"),
          category: sql<string | null>`${event.pricing?.category ?? null}`.as("category"),
          pricingType: sql<string | null>`${event.pricing?.type ?? null}`.as("pricing_type"),
          billable: sql<boolean | null>`${event.pricing?.billable ?? null}::boolean`.as("billable"),
        })
        .from(shopWhatsappAccounts)
        .where(
          and(
            eq(shopWhatsappAccounts.shopId, shopId),
            eq(shopWhatsappAccounts.phoneNumberId, event.phoneNumberId),
            eq(shopWhatsappAccounts.wabaId, event.wabaId),
            // Meta timestamps have second precision. Do not round the assignment
            // backwards: an ambiguous first partial second is unknown usage.
            sql`${shopWhatsappAccounts.numberAssignedAt} <= ${event.occurredAt.toISOString()}::timestamptz`,
          ),
        ),
    )
    .onConflictDoUpdate({
      target: [
        whatsAppDeliveredUsage.shopId,
        whatsAppDeliveredUsage.phoneNumberId,
        whatsAppDeliveredUsage.messageFingerprint,
      ],
      set: {
        pricingModel: sql`coalesce(${whatsAppDeliveredUsage.pricingModel}, excluded.pricing_model)`,
        category: sql`coalesce(${whatsAppDeliveredUsage.category}, excluded.category)`,
        pricingType: sql`coalesce(${whatsAppDeliveredUsage.pricingType}, excluded.pricing_type)`,
        billable: sql`coalesce(${whatsAppDeliveredUsage.billable}, excluded.billable)`,
      },
    });
}

/** Verified deliveries observed by this webhook, not an invoice or complete account usage.
 * Includes courtesy sends without a notification tracking row. No rate card, market, tier
 * or payer is guessed from a phone number, category, app ownership or missing pricing.
 */
export async function readWhatsAppDeliveredUsage(
  db: AppDb,
  input: { shopId: string; start: Date; end: Date },
) {
  const rows = await db
    .select({
      wabaId: whatsAppDeliveredUsage.wabaId,
      phoneNumberId: whatsAppDeliveredUsage.phoneNumberId,
      pricingModel: whatsAppDeliveredUsage.pricingModel,
      category: whatsAppDeliveredUsage.category,
      pricingType: whatsAppDeliveredUsage.pricingType,
      billable: whatsAppDeliveredUsage.billable,
      deliveredMessages: count(),
    })
    .from(whatsAppDeliveredUsage)
    .where(
      and(
        eq(whatsAppDeliveredUsage.shopId, input.shopId),
        gte(whatsAppDeliveredUsage.deliveredAt, input.start),
        lt(whatsAppDeliveredUsage.deliveredAt, input.end),
      ),
    )
    .groupBy(
      whatsAppDeliveredUsage.wabaId,
      whatsAppDeliveredUsage.phoneNumberId,
      whatsAppDeliveredUsage.pricingModel,
      whatsAppDeliveredUsage.category,
      whatsAppDeliveredUsage.pricingType,
      whatsAppDeliveredUsage.billable,
    );
  return rows.map((row) => ({
    ...row,
    source: "verified_delivery_webhook" as const,
    recipientMarket: null,
    rateVersion: null,
    monetaryCost: null,
    currency: null,
    invoicePayer: null,
  }));
}
