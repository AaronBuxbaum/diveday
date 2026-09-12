import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Notification, NotificationProvider } from "@/lib/notifications";
import { seededShopContext } from "@/test/db";
import { getInboundMessage, personThread, recordInboundMessage } from "./inbound-messages";
import { inboundMessages, people, personRoles, staffReplies } from "./schema";
import { sendStaffReply } from "./staff-reply";

/**
 * What a reply promises (ADR 20260907-two-way-inbox, decision 6): it goes out
 * on the channel the diver wrote on, in the diver's own language, threaded
 * against their own `Message-ID`; it is recorded whether it went or not; and a
 * message that is not this shop's, or not this diver's, cannot be answered at
 * all.
 */

const NOW = new Date("2026-07-21T13:30:00.000Z");

type Sent = { notification: Notification };

/** A provider that accepts everything and keeps what it was handed. */
function acceptingProvider(): NotificationProvider & { sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    async send(notification) {
      sent.push({ notification });
      return { status: "sent", providerMessageId: `ses-${sent.length}` };
    },
  };
}

async function shopContext() {
  const { db, shop } = await seededShopContext();
  const [diver] = await db
    .select({ id: people.id, email: people.email, phone: people.phone })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Priya Sharma")))
    .limit(1);
  if (!diver?.email || !diver.phone) throw new Error("seeded diver missing contact details");
  const [staff] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  if (!staff) throw new Error("seeded owner missing");
  return { db, shop, diver: diver as { id: string; email: string; phone: string }, staff };
}

async function inboundEmail(
  db: Awaited<ReturnType<typeof shopContext>>["db"],
  shopId: string,
  fromAddress: string,
  overrides: { subject?: string | null; emailMessageId?: string | null; receivedAt?: Date } = {},
) {
  const result = await recordInboundMessage(db, {
    shopId,
    channel: "email",
    fromAddress,
    subject: overrides.subject === undefined ? "Re: Your Saturday departure" : overrides.subject,
    body: "Could I switch to the afternoon boat?",
    receivedAt: overrides.receivedAt ?? NOW,
    providerMessageId: `email-${Math.random()}`,
    emailMessageId: overrides.emailMessageId ?? "<diver-thread@example.com>",
  });
  if (result.status !== "recorded") throw new Error(`unexpected ${result.status}`);
  return result.id;
}

describe("answering by email", () => {
  it("sends the staffer's words, threads them, and answers the message", async () => {
    const { db, shop, diver, staff } = await shopContext();
    const messageId = await inboundEmail(db, shop.id, diver.email);
    const provider = acceptingProvider();

    const result = await sendStaffReply(db, {
      shopId: shop.id,
      personId: diver.id,
      messageId,
      body: "You’re on the 1pm boat now.",
      sentByPersonId: staff.id,
      now: NOW,
      provider,
    });

    expect(result).toMatchObject({ status: "sent", channel: "email" });
    const sent = provider.sent[0]?.notification;
    expect(sent).toMatchObject({
      kind: "staff_reply",
      to: diver.email.toLowerCase(),
      body: "You’re on the 1pm boat now.",
      // The diver's own subject, marked as a reply exactly once.
      subject: "Re: Your Saturday departure",
      // What files the answer into their thread rather than beside it.
      inReplyTo: "<diver-thread@example.com>",
    });
    // The row minted before the send *is* the row recorded after it, so a
    // queued retry cannot become a second reply.
    if (result.status !== "sent") throw new Error("expected a sent reply");
    const [reply] = await db.select().from(staffReplies).where(eq(staffReplies.id, result.replyId));
    expect(reply).toMatchObject({ status: "sent", personId: diver.id, channel: "email" });

    const message = await getInboundMessage(db, shop.id, messageId);
    expect(message?.answeredAt).not.toBeNull();
  });

  /**
   * **Regression (security review of #1509).** `staffReplySchema.inReplyTo`
   * enforces four rules — trimmed, at least 3 characters, at most 998, no
   * control characters — and this call site passed the stored `Message-ID` on a
   * bare truthiness check. The two arrived on this branch from different sides
   * of the same merge, which is the worst pairing of them: a stricter schema
   * with an unfiltered caller. A diver could therefore kill their own thread
   * for good by sending mail whose `Message-ID` is two characters —
   * `recordInboundMessage` stores it verbatim, the send's `parse` throws, and
   * the shop's answer never leaves. The composer always answers the *latest*
   * message, so repeating it keeps the newest one poisoned.
   *
   * `threadableMessageId` is the schema's own rule rather than a restatement
   * of it, so what this pins is what the comment always claimed: the header is
   * dropped, and the answer goes.
   */
  it("sends the answer unthreaded when the diver's Message-ID is unusable", async () => {
    const { db, shop, diver, staff } = await shopContext();
    // Two characters: printable, single-line, and under the schema's floor.
    const messageId = await inboundEmail(db, shop.id, diver.email, { emailMessageId: "ab" });
    const provider = acceptingProvider();

    const result = await sendStaffReply(db, {
      shopId: shop.id,
      personId: diver.id,
      messageId,
      body: "You’re on the 1pm boat now.",
      sentByPersonId: staff.id,
      now: NOW,
      provider,
    });

    expect(result).toMatchObject({ status: "sent", channel: "email" });
    const sent = provider.sent[0]?.notification;
    if (sent?.kind !== "staff_reply") throw new Error("no staff reply sent");
    expect(sent.inReplyTo).toBeUndefined();
    // The whole point: an unusable header costs the thread, never the reply.
    const message = await getInboundMessage(db, shop.id, messageId);
    expect(message?.answeredAt).not.toBeNull();
  });

  it("names the shop when the diver's mail carried no subject", async () => {
    const { db, shop, diver, staff } = await shopContext();
    const messageId = await inboundEmail(db, shop.id, diver.email, { subject: null });
    const provider = acceptingProvider();
    await sendStaffReply(db, {
      shopId: shop.id,
      personId: diver.id,
      messageId,
      body: "We do.",
      sentByPersonId: staff.id,
      now: NOW,
      provider,
    });
    expect(provider.sent[0]?.notification).toMatchObject({
      subject: `A message from ${shop.name}`,
    });
  });

  it("records a send that did not go, and leaves the message unanswered", async () => {
    const { db, shop, diver, staff } = await shopContext();
    const messageId = await inboundEmail(db, shop.id, diver.email);
    const refusing: NotificationProvider = {
      async send() {
        return { status: "failed", retryable: false, errorCode: "rejected" };
      },
    };

    const result = await sendStaffReply(db, {
      shopId: shop.id,
      personId: diver.id,
      messageId,
      body: "Sorry for the delay.",
      sentByPersonId: staff.id,
      now: NOW,
      provider: refusing,
    });

    expect(result).toMatchObject({ status: "failed", reason: "send_failed" });
    const thread = await personThread(db, shop.id, diver.id);
    // The staffer's words survive the failure — the record is what says the
    // shop tried and the diver never heard.
    expect(
      thread.some((entry) => entry.direction === "outbound" && entry.reply.status === "failed"),
    ).toBe(true);
    expect((await getInboundMessage(db, shop.id, messageId))?.answeredAt).toBeNull();
  });

  it("reports a channel this deployment never switched on as its own outcome", async () => {
    const { db, shop, diver, staff } = await shopContext();
    const messageId = await inboundEmail(db, shop.id, diver.email);
    const result = await sendStaffReply(db, {
      shopId: shop.id,
      personId: diver.id,
      messageId,
      body: "Hello.",
      sentByPersonId: staff.id,
      now: NOW,
      provider: {
        async send() {
          return { status: "not_configured" };
        },
      },
    });
    expect(result).toMatchObject({ status: "failed", reason: "not_configured" });
  });
});

describe("what cannot be answered", () => {
  it("refuses an empty body before it reaches a provider", async () => {
    const { db, shop, diver, staff } = await shopContext();
    const messageId = await inboundEmail(db, shop.id, diver.email);
    const provider = acceptingProvider();
    expect(
      await sendStaffReply(db, {
        shopId: shop.id,
        personId: diver.id,
        messageId,
        body: "   \n  ",
        sentByPersonId: staff.id,
        now: NOW,
        provider,
      }),
    ).toEqual({ status: "refused", reason: "empty_body" });
    expect(provider.sent).toHaveLength(0);
  });

  /**
   * A reply the outbound schema will not take. The address on the record is a
   * real one the diver wrote from, and it is long enough that the notification
   * schema refuses the whole payload — so nothing can be sent, and no amount of
   * pressing the button changes that.
   *
   * Before this, that came back as `provider_error`: a `staff_replies` row
   * filing a provider call that never happened, and a queue entry re-failing on
   * every drain until the attempt cap. The refusal has to be its own, because
   * `no_reply_address` would say "There is no address to answer on" about a
   * message that plainly has one.
   */
  it("refuses a reply the outbound schema cannot take, without recording a send", async () => {
    const { db, shop, diver, staff } = await shopContext();
    // Recorded from the diver's own address so the message is genuinely theirs,
    // then widened on the stored row — which is the real shape: an address the
    // inbound side accepted and filed, that the outbound schema will not take.
    // Well past `DIVER_EMAIL_MAX`, so the payload is refused whatever else is
    // true of it.
    const messageId = await inboundEmail(db, shop.id, diver.email);
    const overlong = `${"a".repeat(320)}@example.com`;
    await db
      .update(inboundMessages)
      .set({ fromAddress: overlong })
      .where(eq(inboundMessages.id, messageId));
    const provider = acceptingProvider();
    const before = (await db.select().from(staffReplies)).length;

    expect(
      await sendStaffReply(db, {
        shopId: shop.id,
        personId: diver.id,
        messageId,
        body: "We can move you to the afternoon boat.",
        sentByPersonId: staff.id,
        now: NOW,
        provider,
      }),
    ).toEqual({ status: "refused", reason: "cannot_be_sent" });

    // Never asked, so never recorded as asked. Counted as a delta because the
    // seeded shop already has replies of its own on file.
    expect(provider.sent).toHaveLength(0);
    expect(await db.select().from(staffReplies)).toHaveLength(before);
  });

  it("refuses a message that belongs to another diver's record", async () => {
    const { db, shop, diver, staff } = await shopContext();
    const [other] = await db
      .select({ id: people.id, email: people.email })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Diego Alvarez")))
      .limit(1);
    if (!other?.email) throw new Error("seeded second diver missing an email");
    const messageId = await inboundEmail(db, shop.id, other.email);
    const provider = acceptingProvider();
    expect(
      await sendStaffReply(db, {
        // Same shop, wrong record: the composer on Priya's page must not be
        // able to answer Diego's mail by posting his message id.
        shopId: shop.id,
        personId: diver.id,
        messageId,
        body: "Hello.",
        sentByPersonId: staff.id,
        now: NOW,
        provider,
      }),
    ).toEqual({ status: "refused", reason: "message_not_found" });
    expect(provider.sent).toHaveLength(0);
  });

  it("refuses a message belonging to another shop", async () => {
    const { db, shop, diver, staff } = await shopContext();
    const messageId = await inboundEmail(db, shop.id, diver.email);
    const provider = acceptingProvider();
    const [foreign] = await db
      .insert(inboundMessages)
      .values({
        shopId: shop.id,
        personId: diver.id,
        channel: "email",
        fromAddress: diver.email.toLowerCase(),
        body: "x",
        receivedAt: NOW,
        providerMessageId: "email-foreign",
      })
      .returning({ id: inboundMessages.id });
    if (!foreign) throw new Error("insert failed");
    expect(
      await sendStaffReply(db, {
        // A shop id that is not the message's: the tenant is the caller's,
        // never the row's.
        shopId: "00000000-0000-4000-8000-000000000000",
        personId: diver.id,
        messageId,
        body: "Hello.",
        sentByPersonId: staff.id,
        now: NOW,
        provider,
      }),
    ).toEqual({ status: "refused", reason: "message_not_found" });
    expect(provider.sent).toHaveLength(0);
  });

  it("refuses a WhatsApp reply once Meta's 24-hour window has closed", async () => {
    const { db, shop, diver, staff } = await shopContext();
    const recorded = await recordInboundMessage(db, {
      shopId: shop.id,
      channel: "whatsapp",
      fromAddress: diver.phone,
      body: "Running late",
      receivedAt: new Date(NOW.getTime() - 25 * 60 * 60 * 1000),
      providerMessageId: "wa-old",
    });
    if (recorded.status !== "recorded") throw new Error("seed message not recorded");
    expect(
      await sendStaffReply(db, {
        shopId: shop.id,
        personId: diver.id,
        messageId: recorded.id,
        body: "No problem.",
        sentByPersonId: staff.id,
        now: NOW,
      }),
    ).toEqual({ status: "refused", reason: "whatsapp_window_closed" });
  });

  it("refuses a WhatsApp reply from a shop with no sender connected", async () => {
    const { db, shop, diver, staff } = await shopContext();
    const recorded = await recordInboundMessage(db, {
      shopId: shop.id,
      channel: "whatsapp",
      fromAddress: diver.phone,
      body: "Running late",
      receivedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
      providerMessageId: "wa-fresh",
    });
    if (recorded.status !== "recorded") throw new Error("seed message not recorded");
    expect(
      await sendStaffReply(db, {
        shopId: shop.id,
        personId: diver.id,
        messageId: recorded.id,
        body: "No problem.",
        sentByPersonId: staff.id,
        now: NOW,
      }),
    ).toEqual({ status: "refused", reason: "whatsapp_not_connected" });
  });
});
