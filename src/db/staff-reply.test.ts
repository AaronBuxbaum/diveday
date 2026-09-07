import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Notification } from "@/lib/notifications";
import type { NotificationProvider } from "@/lib/notifications/provider";
import { seededShopContext } from "@/test/db";
import { recordInboundMessage } from "./inbound-messages";
import { inboundMessages, people, personRoles, staffReplies } from "./schema";
import { sendStaffReply } from "./staff-reply";

/**
 * **Answering a diver in the channel they wrote in** (ADR
 * 20260907-two-way-inbox, decision 6). The contract this pins:
 *
 * - the channel is the diver's, never chosen by the shop;
 * - a sent reply answers the message it was written to, and a failed one
 *   leaves it unanswered, because it is;
 * - the WhatsApp window is checked before the send, not read off Meta's error;
 * - a stranger's message has no record to answer from and is refused.
 */

const NOW = new Date("2026-07-21T13:30:00.000Z");
type Ctx = Awaited<ReturnType<typeof seededShopContext>>;

async function personNamed(db: Ctx["db"], shopId: string, fullName: string) {
  const [row] = await db
    .select({ id: people.id, email: people.email, phone: people.phone })
    .from(people)
    .where(and(eq(people.shopId, shopId), eq(people.fullName, fullName)))
    .limit(1);
  if (!row?.email || !row.phone) throw new Error(`seed is missing ${fullName}`);
  return row as { id: string; email: string; phone: string };
}

async function anyStaff(db: Ctx["db"], shopId: string) {
  const [row] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shopId), eq(personRoles.role, "owner")))
    .limit(1);
  if (!row) throw new Error("seed is missing an owner");
  return row.id;
}

/** A provider that says yes and keeps what it was handed. */
function capturingEmailProvider(): NotificationProvider & { sent: Notification[] } {
  const sent: Notification[] = [];
  return {
    sent,
    async send(notification) {
      sent.push(notification);
      return { status: "sent", providerMessageId: "ses-reply-1" };
    },
  };
}

describe("sendStaffReply", () => {
  it("answers an email in its own thread and stamps the message answered", async () => {
    const { db, shop } = await seededShopContext();
    const diver = await personNamed(db, shop.id, "Priya Sharma");
    const staff = await anyStaff(db, shop.id);
    const inbound = await recordInboundMessage(db, {
      shopId: shop.id,
      channel: "email",
      fromAddress: diver.email,
      subject: "Re: Saturday",
      body: "Can I move to the afternoon boat?",
      receivedAt: NOW,
      providerMessageId: "email-reply-1",
      emailMessageId: "<diver-1@mail.example>",
    });
    if (inbound.status !== "recorded") throw new Error("fixture not recorded");

    const provider = capturingEmailProvider();
    const result = await sendStaffReply(
      db,
      {
        shopId: shop.id,
        messageId: inbound.id,
        body: "Of course. You're on the 1pm boat.",
        sentByPersonId: staff,
        now: NOW,
      },
      { emailProvider: provider },
    );
    expect(result.status).toBe("sent");

    const [notification] = provider.sent;
    if (notification?.kind !== "staff_reply") throw new Error("no staff reply sent");
    // The diver's own `Message-ID`, which is what files the answer into their
    // thread rather than beside it.
    expect(notification.inReplyTo).toBe("<diver-1@mail.example>");
    expect(notification.subject).toBe("Re: Saturday");
    expect(notification.to).toBe(diver.email.toLowerCase());
    // The row exists under the id the idempotency key names.
    expect(notification.replyId).toBe(result.status === "sent" ? result.replyId : "");

    const [reply] = await db
      .select()
      .from(staffReplies)
      .where(eq(staffReplies.inboundMessageId, inbound.id));
    expect(reply).toMatchObject({ status: "sent", channel: "email", personId: diver.id });
    const [message] = await db
      .select()
      .from(inboundMessages)
      .where(eq(inboundMessages.id, inbound.id));
    expect(message?.answeredAt).toEqual(NOW);
  });

  it("records a failed send and leaves the message waiting", async () => {
    const { db, shop } = await seededShopContext();
    const diver = await personNamed(db, shop.id, "Priya Sharma");
    const staff = await anyStaff(db, shop.id);
    const inbound = await recordInboundMessage(db, {
      shopId: shop.id,
      channel: "email",
      fromAddress: diver.email,
      body: "Anything Saturday?",
      receivedAt: NOW,
      providerMessageId: "email-reply-2",
    });
    if (inbound.status !== "recorded") throw new Error("fixture not recorded");

    const result = await sendStaffReply(
      db,
      {
        shopId: shop.id,
        messageId: inbound.id,
        body: "Two seats left.",
        sentByPersonId: staff,
        now: NOW,
      },
      {
        emailProvider: {
          async send() {
            return { status: "failed", retryable: true, errorCode: "throttled" };
          },
        },
      },
    );
    expect(result).toEqual({ status: "refused", reason: "send_failed" });

    const [reply] = await db
      .select()
      .from(staffReplies)
      .where(eq(staffReplies.inboundMessageId, inbound.id));
    expect(reply).toMatchObject({ status: "failed", sendErrorCode: "throttled" });
    const [message] = await db
      .select()
      .from(inboundMessages)
      .where(eq(inboundMessages.id, inbound.id));
    // Unanswered, because it is — the diver has heard nothing.
    expect(message?.answeredAt).toBeNull();
  });

  it("answers a WhatsApp on WhatsApp, at the number the diver wrote from", async () => {
    const { db, shop } = await seededShopContext();
    const diver = await personNamed(db, shop.id, "Priya Sharma");
    const staff = await anyStaff(db, shop.id);
    const inbound = await recordInboundMessage(db, {
      shopId: shop.id,
      channel: "whatsapp",
      fromAddress: diver.phone,
      body: "Running late",
      receivedAt: new Date("2026-07-21T12:00:00.000Z"),
      providerMessageId: "wamid.reply-1",
    });
    if (inbound.status !== "recorded") throw new Error("fixture not recorded");

    const sentTo: string[] = [];
    const result = await sendStaffReply(
      db,
      {
        shopId: shop.id,
        messageId: inbound.id,
        body: "No problem, we'll wait.",
        sentByPersonId: staff,
        now: NOW,
      },
      {
        whatsAppSender: {
          async sendText(message) {
            sentTo.push(message.to);
            return { status: "sent", providerMessageId: "wamid.out-1" };
          },
        },
      },
    );
    expect(result.status).toBe("sent");
    expect(sentTo).toEqual([`+${diver.phone.replace(/\D/g, "")}`]);
    const [reply] = await db
      .select()
      .from(staffReplies)
      .where(eq(staffReplies.inboundMessageId, inbound.id));
    expect(reply?.channel).toBe("whatsapp");
  });

  it("refuses a WhatsApp reply once Meta's 24-hour window has closed", async () => {
    const { db, shop } = await seededShopContext();
    const diver = await personNamed(db, shop.id, "Priya Sharma");
    const staff = await anyStaff(db, shop.id);
    const inbound = await recordInboundMessage(db, {
      shopId: shop.id,
      channel: "whatsapp",
      fromAddress: diver.phone,
      body: "Thanks!",
      receivedAt: new Date("2026-07-19T12:00:00.000Z"),
      providerMessageId: "wamid.reply-stale",
    });
    if (inbound.status !== "recorded") throw new Error("fixture not recorded");

    let attempted = false;
    const result = await sendStaffReply(
      db,
      {
        shopId: shop.id,
        messageId: inbound.id,
        body: "See you Saturday.",
        sentByPersonId: staff,
        now: NOW,
      },
      {
        whatsAppSender: {
          async sendText() {
            attempted = true;
            return { status: "sent", providerMessageId: "never" };
          },
        },
      },
    );
    expect(result).toEqual({ status: "refused", reason: "window_closed" });
    // Refused before the provider, not by reading its error afterwards.
    expect(attempted).toBe(false);
    expect(
      await db.select().from(staffReplies).where(eq(staffReplies.inboundMessageId, inbound.id)),
    ).toHaveLength(0);
  });

  it("refuses a stranger's message, another shop's message, and an empty body", async () => {
    const { db, shop } = await seededShopContext();
    const diver = await personNamed(db, shop.id, "Priya Sharma");
    const staff = await anyStaff(db, shop.id);
    const stranger = await recordInboundMessage(db, {
      shopId: shop.id,
      channel: "email",
      fromAddress: "nobody.here@example.net",
      body: "Night dives in October?",
      receivedAt: NOW,
      providerMessageId: "email-stranger-reply",
    });
    if (stranger.status !== "recorded") throw new Error("fixture not recorded");
    const mine = await recordInboundMessage(db, {
      shopId: shop.id,
      channel: "email",
      fromAddress: diver.email,
      body: "Saturday?",
      receivedAt: NOW,
      providerMessageId: "email-mine",
    });
    if (mine.status !== "recorded") throw new Error("fixture not recorded");

    const base = { shopId: shop.id, sentByPersonId: staff, now: NOW };
    // Nobody to answer: the address matched no record in this shop.
    expect(
      await sendStaffReply(db, { ...base, messageId: stranger.id, body: "Yes, weekly." }),
    ).toEqual({ status: "refused", reason: "message_unavailable" });
    // A different tenant asking for this shop's message gets nothing back.
    expect(
      await sendStaffReply(db, {
        ...base,
        shopId: "00000000-0000-4000-8000-000000000000",
        messageId: mine.id,
        body: "Yes.",
      }),
    ).toEqual({ status: "refused", reason: "message_unavailable" });
    expect(await sendStaffReply(db, { ...base, messageId: mine.id, body: "   " })).toEqual({
      status: "refused",
      reason: "empty_body",
    });
    // A form field naming another of this shop's messages does not answer a
    // conversation the staffer is not looking at.
    expect(
      await sendStaffReply(db, {
        ...base,
        messageId: mine.id,
        expectedPersonId: "00000000-0000-4000-8000-000000000001",
        body: "Yes.",
      }),
    ).toEqual({ status: "refused", reason: "message_unavailable" });
  });

  it("will not write to a diver the shop has deleted", async () => {
    const { db, shop } = await seededShopContext();
    const diver = await personNamed(db, shop.id, "Priya Sharma");
    const staff = await anyStaff(db, shop.id);
    const inbound = await recordInboundMessage(db, {
      shopId: shop.id,
      channel: "email",
      fromAddress: diver.email,
      body: "Still on for Saturday?",
      receivedAt: NOW,
      providerMessageId: "email-deleted-diver",
    });
    if (inbound.status !== "recorded") throw new Error("fixture not recorded");
    await db.update(people).set({ deletedAt: NOW }).where(eq(people.id, diver.id));

    const provider = capturingEmailProvider();
    expect(
      await sendStaffReply(
        db,
        {
          shopId: shop.id,
          messageId: inbound.id,
          body: "Yes, see you at seven.",
          sentByPersonId: staff,
          now: NOW,
        },
        { emailProvider: provider },
      ),
    ).toEqual({ status: "refused", reason: "message_unavailable" });
    expect(provider.sent).toHaveLength(0);
  });
});
