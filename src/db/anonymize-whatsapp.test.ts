// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { setLogSink } from "@/lib/log";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import type { AppDb } from "./client";
import { recordStaffReply } from "./inbound-messages";
import {
  bookings,
  customerGearNotices,
  inboundMessages,
  lostItems,
  notificationDeliveries,
  notificationDeliveryAttempts,
  people,
  personRoles,
  processorErasureObligations,
  shops,
  shopWhatsappAccounts,
  staffReplies,
  trips,
  waiverDeliveries,
  waiverRecords,
  waiverTemplates,
} from "./schema";

const ctx = fileScopedShopContext();

/**
 * Erasure reaches the shop's WhatsApp chats (issue #1721, ADR
 * 20260803-processor-erasure-obligations, "Widened 2026-10-17").
 *
 * The chat sits in the shop's own WhatsApp Business account at Meta, which has
 * no delete for a message, so the erasure raises one `whatsapp_conversation`
 * obligation per diver number and the owner discharges it. SES and SNS ids
 * raise nothing: those logs are DiveDay's own, in DiveDay's AWS account.
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

/**
 * A finished connection, made long before any seeded departure, so a booked
 * diver's reminders could have gone from it. `templateName: ""` is a parked
 * signup that never finished, and sends nothing.
 */
async function connectWhatsApp(
  db: AppDb,
  shopId: string,
  phoneNumberId: string,
  options: { templateName?: string; connectedAt?: Date } = {},
) {
  await db.insert(shopWhatsappAccounts).values({
    shopId,
    phoneNumberId,
    accessTokenSealed: "sealed-token-fixture",
    templateName: options.templateName ?? "courtesy",
    templateLanguage: "en_US",
    connectedAt: options.connectedAt ?? new Date("2000-01-01T00:00:00.000Z"),
  });
}

async function anyTripId(db: AppDb, shopId: string): Promise<string> {
  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(eq(trips.shopId, shopId))
    .orderBy(trips.id)
    .limit(1);
  if (!trip) throw new Error("expected a seeded departure");
  return trip.id;
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

async function chatsOwed(db: AppDb, shopId: string) {
  const rows = await db
    .select()
    .from(processorErasureObligations)
    .where(
      and(
        eq(processorErasureObligations.shopId, shopId),
        eq(processorErasureObligations.target, "whatsapp_conversation"),
      ),
    );
  return rows.map((row) => ({ number: row.externalId, account: row.providerAccountId }));
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

describe("anonymizeDiver — the shop's WhatsApp chats (issue #1721)", () => {
  it("owes the chat a diver wrote in on, against the shop's number", async () => {
    const { db, shop } = ctx;
    await connectWhatsApp(db, shop.id, "pn_shop_main");
    const diverId = await diverAt(db, shop.id, { fullName: "Wren Wave", phone: "+13055550177" });
    await whatsAppFrom(db, shop.id, "13055550177", "wamid.in-1", diverId);

    const result = await erase(db, shop.id, diverId);

    expect(await chatsOwed(db, shop.id)).toEqual([
      { number: "+13055550177", account: "pn_shop_main" },
    ]);
    // The chat is the owner's to delete, so the erasure reports it still owed.
    expect(result).toMatchObject({ owedProcessorErasures: 1 });
  });

  it("raises one chat per number, however many messages and replies it held", async () => {
    const { db, shop } = ctx;
    await connectWhatsApp(db, shop.id, "pn_shop_main");
    const diverId = await diverAt(db, shop.id, { fullName: "Wren Wave", phone: "+13055550177" });
    await bookOnto(db, shop.id, diverId);
    await whatsAppFrom(db, shop.id, "13055550177", "wamid.in-1", diverId);
    await whatsAppFrom(db, shop.id, "13055550177", "wamid.in-2", diverId);
    await recordStaffReply(db, {
      shopId: shop.id,
      personId: diverId,
      inboundMessageId: null,
      channel: "whatsapp",
      toAddress: "13055550177",
      body: "See you at 7",
      locale: "en-US",
      sentByPersonId: null,
      delivery: { status: "sent", providerMessageId: "wamid.out-1" },
      sentAt: new Date("2026-07-19T11:00:00.000Z"),
    });

    await erase(db, shop.id, diverId);

    expect(await chatsOwed(db, shop.id)).toEqual([
      { number: "+13055550177", account: "pn_shop_main" },
    ]);
  });

  it("owes a second chat when the diver also wrote from another number", async () => {
    const { db, shop } = ctx;
    await connectWhatsApp(db, shop.id, "pn_shop_main");
    const diverId = await diverAt(db, shop.id, { fullName: "Wren Wave", phone: "+13055550177" });
    await whatsAppFrom(db, shop.id, "13055550177", "wamid.in-1", diverId);
    await whatsAppFrom(db, shop.id, "447700900123", "wamid.in-2", diverId);

    await erase(db, shop.id, diverId);

    expect((await chatsOwed(db, shop.id)).map((row) => row.number).sort()).toEqual([
      "+13055550177",
      "+447700900123",
    ]);
  });

  it("owes the chat a WhatsApp reminder opened, though the diver never wrote", async () => {
    // A courtesy text goes out from the shop's number whenever one is
    // connected, and the reminder that carried it is not recorded by channel.
    // A booked diver with a number at such a shop has a chat there.
    const { db, shop } = ctx;
    await connectWhatsApp(db, shop.id, "pn_shop_main");
    const diverId = await diverAt(db, shop.id, { fullName: "Quiet Quill", phone: "+13055550199" });
    await bookOnto(db, shop.id, diverId);

    await erase(db, shop.id, diverId);

    expect(await chatsOwed(db, shop.id)).toEqual([
      { number: "+13055550199", account: "pn_shop_main" },
    ]);
  });

  it("owes the chat a recorded WhatsApp send opened after the shop disconnected", async () => {
    const { db, shop } = ctx;
    const diverId = await diverAt(db, shop.id, { fullName: "Gone Gale", phone: "+13055550155" });
    const bookingId = await bookOnto(db, shop.id, diverId);
    await db.insert(notificationDeliveries).values({
      shopId: shop.id,
      bookingId,
      kind: "trip_reminder_24h",
      status: "sent",
      providerMessageId: "wamid.HBgLMTMwNTU1NTAxNTU=",
      attemptedAt: new Date("2026-07-18T10:00:00.000Z"),
    });

    await erase(db, shop.id, diverId);

    // No number is connected any more, so the row names no account. The chat
    // is still on the shop's WhatsApp, and still owed.
    expect(await chatsOwed(db, shop.id)).toEqual([{ number: "+13055550155", account: null }]);
  });

  it("owes the chat a waiver link opened over WhatsApp, with no booking at all", async () => {
    const { db, shop } = ctx;
    const diverId = await diverAt(db, shop.id, { fullName: "Paper Trail", phone: "+13055550144" });
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
        tokenHash: "whatsapp-erasure-token-hash",
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      })
      .returning({ id: waiverRecords.id });
    if (!record) throw new Error("fixture insert failed");
    await db.insert(waiverDeliveries).values({
      shopId: shop.id,
      waiverRecordId: record.id,
      channel: "text",
      status: "sent",
      providerMessageId: "wamid.waiver-1",
      attemptedAt: new Date("2026-03-01T12:00:00.000Z"),
    });

    await erase(db, shop.id, diverId);

    expect(await chatsOwed(db, shop.id)).toEqual([{ number: "+13055550144", account: null }]);
  });

  it("raises nothing for SES and SNS sends — DiveDay's own logs discharge those", async () => {
    const { db, shop } = ctx;
    const diverId = await diverAt(db, shop.id, {
      fullName: "Plain Text",
      phone: "+13055550166",
      email: "plain.text@example.org",
    });
    const bookingId = await bookOnto(db, shop.id, diverId);
    await db.insert(notificationDeliveries).values({
      shopId: shop.id,
      bookingId,
      kind: "trip_reminder_24h",
      status: "sent",
      providerMessageId: "0100018f-ses-message-id",
      attemptedAt: new Date("2026-07-18T10:00:00.000Z"),
    });
    await db.insert(inboundMessages).values({
      shopId: shop.id,
      personId: diverId,
      channel: "email",
      fromAddress: "plain.text@example.org",
      body: "thanks",
      receivedAt: new Date("2026-07-19T10:00:00.000Z"),
      providerMessageId: "ses-inbound-1",
    });

    await erase(db, shop.id, diverId);

    expect(await chatsOwed(db, shop.id)).toEqual([]);
    const all = await db
      .select({ target: processorErasureObligations.target })
      .from(processorErasureObligations)
      .where(eq(processorErasureObligations.shopId, shop.id));
    expect(all).toEqual([]);
  });

  it("owes nothing for a diver with no number at a shop with WhatsApp", async () => {
    const { db, shop } = ctx;
    await connectWhatsApp(db, shop.id, "pn_shop_main");
    const diverId = await diverAt(db, shop.id, {
      fullName: "Mail Only",
      email: "mail.only@example.org",
    });
    await bookOnto(db, shop.id, diverId);

    await erase(db, shop.id, diverId);

    expect(await chatsOwed(db, shop.id)).toEqual([]);
  });

  it("does not raise a chat for another diver's number, or for another shop's chat", async () => {
    const { db, shop } = ctx;
    await connectWhatsApp(db, shop.id, "pn_shop_main");
    const diverId = await diverAt(db, shop.id, { fullName: "Wren Wave", phone: "+13055550177" });
    await whatsAppFrom(db, shop.id, "13055550177", "wamid.in-1", diverId);
    // Somebody else in this shop, writing from their own number.
    const neighbourId = await diverAt(db, shop.id, {
      fullName: "Next Door",
      phone: "+13055550100",
    });
    await whatsAppFrom(db, shop.id, "13055550100", "wamid.in-2", neighbourId);
    // The same number writing to a different shop: that chat is on that
    // shop's WhatsApp, and this erasure is not theirs.
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-whatsapp-erasure", timezone: "UTC" })
      .returning();
    if (!otherShop) throw new Error("second shop insert failed");
    await whatsAppFrom(db, otherShop.id, "13055550177", "wamid.in-3");

    await erase(db, shop.id, diverId);

    expect(await chatsOwed(db, shop.id)).toEqual([
      { number: "+13055550177", account: "pn_shop_main" },
    ]);
    expect(await chatsOwed(db, otherShop.id)).toEqual([]);
    const [theirs] = await db
      .select({ fromAddress: inboundMessages.fromAddress })
      .from(inboundMessages)
      .where(eq(inboundMessages.providerMessageId, "wamid.in-3"));
    expect(theirs?.fromAddress).toBe("13055550177");
  });

  it("does not mistake an already-redacted address for a number", async () => {
    // A message an earlier erasure already redacted, reached again by the
    // person link of a later one, must not raise a chat for the placeholder.
    const { db, shop } = ctx;
    await connectWhatsApp(db, shop.id, "pn_shop_main");
    const diverId = await diverAt(db, shop.id, { fullName: "No Phone" });
    await whatsAppFrom(db, shop.id, "[redacted]", "wamid.in-1", diverId);

    await erase(db, shop.id, diverId);

    expect(await chatsOwed(db, shop.id)).toEqual([]);
  });

  it("owes nothing at a shop whose WhatsApp signup is parked", async () => {
    // A parked row (`templateName: ""`) never finished connecting and has sent
    // nothing, so a booked diver with a number has no chat there.
    const { db, shop } = ctx;
    await connectWhatsApp(db, shop.id, "pn_parked", { templateName: "" });
    const diverId = await diverAt(db, shop.id, { fullName: "Parked Pat", phone: "+13055550122" });
    await bookOnto(db, shop.id, diverId);

    await erase(db, shop.id, diverId);

    expect(await chatsOwed(db, shop.id)).toEqual([]);
  });

  it("owes nothing for a booking whose departure was before the number was connected", async () => {
    const { db, shop } = ctx;
    await connectWhatsApp(db, shop.id, "pn_late", {
      connectedAt: new Date("2099-01-01T00:00:00.000Z"),
    });
    const diverId = await diverAt(db, shop.id, { fullName: "Early Bird", phone: "+13055550123" });
    await bookOnto(db, shop.id, diverId);

    await erase(db, shop.id, diverId);

    expect(await chatsOwed(db, shop.id)).toEqual([]);
  });

  it("owes the chat a gear-ready notice opened for a bench customer with no booking", async () => {
    const { db, shop } = ctx;
    const diverId = await diverAt(db, shop.id, { fullName: "Bench Ben", phone: "+13055550133" });
    await db.insert(customerGearNotices).values({
      shopId: shop.id,
      kind: "ready_for_pickup",
      personId: diverId,
      status: "sent",
      channel: "whatsapp",
    });

    await erase(db, shop.id, diverId);

    expect(await chatsOwed(db, shop.id)).toEqual([{ number: "+13055550133", account: null }]);
  });

  it("owes the chat a lost-item tell opened, after the shop disconnected", async () => {
    const { db, shop } = ctx;
    const diverId = await diverAt(db, shop.id, { fullName: "Lost Lou", phone: "+13055550134" });
    const bookingId = await bookOnto(db, shop.id, diverId);
    await db.insert(lostItems).values({
      shopId: shop.id,
      tripId: await anyTripId(db, shop.id),
      bookingId,
      personId: diverId,
      description: "blue mask, seat 4",
      toldAt: new Date("2026-07-20T10:00:00.000Z"),
      toldChannel: "whatsapp",
    });

    await erase(db, shop.id, diverId);

    expect(await chatsOwed(db, shop.id)).toEqual([{ number: "+13055550134", account: null }]);
  });

  it("logs a chat raised by the number alone, which a household can share", async () => {
    const { db, shop } = ctx;
    const diverId = await diverAt(db, shop.id, { fullName: "Shared Line", phone: "+13055550135" });
    await whatsAppFrom(db, shop.id, "13055550135", "wamid.unlinked-1");
    const lines: string[] = [];
    setLogSink((line) => lines.push(line));
    try {
      await erase(db, shop.id, diverId);
    } finally {
      setLogSink(null);
    }
    expect(lines.some((line) => line.includes('"predicate":"whatsapp_chat_number"'))).toBe(true);
  });

  /**
   * Security review F1: Meta's message id embeds the recipient's number in
   * base64 (`wamid.HBgLMTMwNTU1NTAxNTU=` carries `13055550155`). Kept as it
   * was, every delivery row would still say who the erased diver was after the
   * chat obligation forgot the number. Each one becomes `wamid.` plus a
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

    // Still raised: the chat is found from the ids before they are rewritten.
    expect(await chatsOwed(db, shop.id)).toEqual([{ number: "+13055550155", account: null }]);

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
