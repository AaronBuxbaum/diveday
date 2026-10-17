// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import type { AppDb } from "./client";
import { recordStaffReply } from "./inbound-messages";
import {
  bookings,
  inboundMessages,
  notificationDeliveries,
  notificationDeliveryAttempts,
  people,
  personRoles,
  processorErasureObligations,
  staffReplies,
  trips,
  waiverDeliveries,
  waiverRecords,
  waiverTemplates,
} from "./schema";

const ctx = fileScopedShopContext();

/**
 * WhatsApp at erasure (issue #1721, ADR 20260803-processor-erasure-obligations,
 * "Widened 2026-10-17").
 *
 * No obligation is raised for it: the Cloud API keeps a message at most 30
 * days and offers a business no view or delete, so there is nothing for an
 * owner to do. What the erasure does is local: it redacts the inbox and
 * rewrites every kept `wamid.` id, which embeds the diver's number.
 */

async function ownerOf(db: AppDb, shopId: string): Promise<string> {
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shopId), eq(personRoles.role, "owner")))
    .limit(1);
  if (!owner) throw new Error("expected the seeded owner");
  return owner.id;
}

async function diverAt(
  db: AppDb,
  shopId: string,
  values: { fullName: string; phone?: string | null; email?: string | null },
): Promise<string> {
  const [diver] = await db
    .insert(people)
    .values({ shopId, ...values })
    .returning({ id: people.id });
  if (!diver) throw new Error("fixture insert failed");
  await db.insert(personRoles).values({ personId: diver.id, role: "diver" });
  return diver.id;
}

async function bookOnto(db: AppDb, shopId: string, personId: string): Promise<string> {
  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(eq(trips.shopId, shopId))
    .orderBy(trips.id)
    .limit(1);
  if (!trip) throw new Error("expected a seeded departure");
  const [booking] = await db
    .insert(bookings)
    .values({ bookedAs: "diver", shopId, tripId: trip.id, personId })
    .returning({ id: bookings.id });
  if (!booking) throw new Error("fixture insert failed");
  return booking.id;
}

async function whatsAppFrom(
  db: AppDb,
  shopId: string,
  fromAddress: string,
  providerMessageId: string,
  personId: string | null = null,
) {
  await db.insert(inboundMessages).values({
    shopId,
    personId,
    channel: "whatsapp",
    fromAddress,
    body: "see you on the boat",
    receivedAt: new Date("2026-07-19T10:00:00.000Z"),
    providerMessageId,
    senderAuthenticated: true,
  });
}

async function erase(db: AppDb, shopId: string, personId: string) {
  const result = await anonymizeDiver(db, {
    shopId,
    personId,
    actorPersonId: await ownerOf(db, shopId),
  });
  expect(result.ok).toBe(true);
  return result;
}

describe("anonymizeDiver — WhatsApp (issue #1721)", () => {
  /**
   * Security review F1: Meta's message id embeds the recipient's number in
   * base64 (`wamid.HBgLMTMwNTU1NTAxNTU=` carries `13055550155`). Kept as it
   * was, every delivery row would still say who the erased diver was. Each one becomes `wamid.` plus a
   * SHA-256 of itself: still evidence that a WhatsApp message went, still
   * found by the `wamid.` prefix, and no longer a number.
   */
  it("forgets the number inside every WhatsApp message id it keeps", async () => {
    const { db, shop } = ctx;
    const NUMBER_B64 = "MTMwNTU1NTAxNTU";
    const wamid = (tag: string) => `wamid.HBgL${NUMBER_B64}=${tag}`;
    const diverId = await diverAt(db, shop.id, { fullName: "Gone Gale", phone: "+13055550155" });
    const bookingId = await bookOnto(db, shop.id, diverId);
    await db.insert(notificationDeliveries).values({
      shopId: shop.id,
      bookingId,
      kind: "trip_reminder_24h",
      status: "sent",
      providerMessageId: wamid("d"),
      attemptedAt: new Date("2026-07-18T10:00:00.000Z"),
    });
    await db.insert(notificationDeliveryAttempts).values({
      shopId: shop.id,
      bookingId,
      kind: "trip_reminder_24h",
      status: "sent",
      providerMessageId: wamid("a"),
      attemptedAt: new Date("2026-07-18T10:00:00.000Z"),
    });
    await whatsAppFrom(db, shop.id, "13055550155", wamid("i1"), diverId);
    await whatsAppFrom(db, shop.id, "13055550155", wamid("i2"));
    await recordStaffReply(db, {
      shopId: shop.id,
      personId: diverId,
      inboundMessageId: null,
      channel: "whatsapp",
      toAddress: "13055550155",
      body: "See you at 7",
      locale: "en-US",
      sentByPersonId: null,
      delivery: { status: "sent", providerMessageId: wamid("r") },
      sentAt: new Date("2026-07-19T11:00:00.000Z"),
    });
    const [template] = await db
      .select({ id: waiverTemplates.id })
      .from(waiverTemplates)
      .where(eq(waiverTemplates.shopId, shop.id))
      .orderBy(waiverTemplates.id)
      .limit(1);
    if (!template) throw new Error("expected a seeded waiver template");
    const [record] = await db
      .insert(waiverRecords)
      .values({
        shopId: shop.id,
        personId: diverId,
        templateId: template.id,
        templateTitle: "Liability release",
        templateVersion: 1,
        templateBody: "the text as it stood",
        tokenHash: "wamid-forget-token-hash",
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        deliveryProviderMessageId: wamid("w"),
      })
      .returning({ id: waiverRecords.id });
    if (!record) throw new Error("fixture insert failed");
    await db.insert(waiverDeliveries).values({
      shopId: shop.id,
      waiverRecordId: record.id,
      channel: "text",
      status: "sent",
      providerMessageId: wamid("w"),
      attemptedAt: new Date("2026-03-01T12:00:00.000Z"),
    });
    // Somebody else's message in the same shop, and an SES id on this diver.
    await whatsAppFrom(db, shop.id, "13055550100", "wamid.HBgLMTMwNTU1NTAxMDA=other");

    await erase(db, shop.id, diverId);

    // Nothing is owed at Meta: no row of any kind.
    expect(
      await db
        .select({ id: processorErasureObligations.id })
        .from(processorErasureObligations)
        .where(eq(processorErasureObligations.shopId, shop.id)),
    ).toEqual([]);

    const kept = [
      ...(
        await db
          .select({ id: notificationDeliveries.providerMessageId })
          .from(notificationDeliveries)
          .where(eq(notificationDeliveries.bookingId, bookingId))
      ).map((row) => row.id),
      ...(
        await db
          .select({ id: notificationDeliveryAttempts.providerMessageId })
          .from(notificationDeliveryAttempts)
          .where(eq(notificationDeliveryAttempts.bookingId, bookingId))
      ).map((row) => row.id),
      ...(
        await db
          .select({ id: inboundMessages.providerMessageId })
          .from(inboundMessages)
          .where(
            and(
              eq(inboundMessages.shopId, shop.id),
              eq(inboundMessages.channel, "whatsapp"),
              eq(inboundMessages.body, "[redacted]"),
            ),
          )
      ).map((row) => row.id),
      ...(
        await db
          .select({ id: staffReplies.providerMessageId })
          .from(staffReplies)
          .where(eq(staffReplies.personId, diverId))
      ).map((row) => row.id),
      ...(
        await db
          .select({ id: waiverDeliveries.providerMessageId })
          .from(waiverDeliveries)
          .where(eq(waiverDeliveries.waiverRecordId, record.id))
      ).map((row) => row.id),
      ...(
        await db
          .select({ id: waiverRecords.deliveryProviderMessageId })
          .from(waiverRecords)
          .where(eq(waiverRecords.id, record.id))
      ).map((row) => row.id),
    ];
    expect(kept).toHaveLength(7);
    for (const id of kept) {
      expect(id).toMatch(/^wamid\.[0-9a-f]{64}$/);
      expect(id).not.toContain(NUMBER_B64);
    }
    const [other] = await db
      .select({ id: inboundMessages.providerMessageId })
      .from(inboundMessages)
      .where(eq(inboundMessages.fromAddress, "13055550100"));
    expect(other?.id).toBe("wamid.HBgLMTMwNTU1NTAxMDA=other");
  });
});
