import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { recordInboundMessage, recordStaffReply } from "./inbound-messages";
import { withRetiredSavedAnswers } from "./retired-saved-answers";
import { inboundMessages, inboxSavedAnswers, people, personRoles, staffReplies } from "./schema";

const ctx = fileScopedShopContext();

/**
 * Erasure reaches the inbox (ADR 20260907-two-way-inbox). A diver's message is
 * their own words under their own address, and the shop's reply names them in
 * its `To:`; both are personal data end to end. The rows stay — that the shop
 * heard from somebody on a given day is the shop's record — and everything
 * that says *who* goes, including a message from before the address matched a
 * record, which is the same fuzzy handle the course-inquiry sweep keeps.
 */
describe("anonymizeDiver — the inbox", () => {
  it("does not hide a failed saved-answer delete when the table exists", async () => {
    await expect(
      withRetiredSavedAnswers(ctx.db, (tx) =>
        tx.delete(inboxSavedAnswers).where(eq(inboxSavedAnswers.shopId, "not-a-uuid")),
      ),
    ).rejects.toThrow();
  });

  it("continues erasure when the retired answers table has been dropped", async () => {
    const { db, shop } = ctx;
    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
      .limit(1);
    if (!owner) throw new Error("expected the seeded owner");
    const [diver] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Erased Diver" })
      .returning({ id: people.id });
    if (!diver) throw new Error("fixture insert failed");
    await db.insert(personRoles).values({ personId: diver.id, role: "diver" });

    // The file fixture rolls DDL back; this simulates the next release's drop.
    await db.execute(sql`drop table inbox_saved_answers`);
    const result = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      actorPersonId: owner.id,
    });
    expect(result.ok).toBe(true);
    const [row] = await db
      .select({ anonymizedAt: people.anonymizedAt })
      .from(people)
      .where(eq(people.id, diver.id));
    expect(row?.anonymizedAt).not.toBeNull();
  });

  it("redacts what the diver wrote, what they wrote from, and what the shop wrote back", async () => {
    const { db, shop } = ctx;
    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
      .limit(1);
    if (!owner) throw new Error("expected the seeded owner");

    const [diver] = await db
      .insert(people)
      .values({
        shopId: shop.id,
        fullName: "Erased Diver",
        email: "erased.diver@example.org",
        phone: "+1 (305) 555-0177",
      })
      .returning({ id: people.id });
    if (!diver) throw new Error("fixture insert failed");
    await db.insert(personRoles).values({ personId: diver.id, role: "diver" });

    const matched = await recordInboundMessage(db, {
      senderAuthenticated: true,
      shopId: shop.id,
      channel: "email",
      fromAddress: "erased.diver@example.org",
      subject: "About Saturday",
      body: "I have a bad knee, can I skip the ladder?",
      receivedAt: new Date("2026-07-20T10:00:00.000Z"),
      providerMessageId: "erase-1",
    });
    if (matched.status !== "recorded") throw new Error("not recorded");
    // What a Claude assist read in it (ADR 20261018-claude-assists): the
    // translation is the diver's words, and goes with them.
    await db
      .update(inboundMessages)
      .set({
        assistIntent: "question",
        assistLanguage: "es",
        assistTranslation: "Tengo la rodilla mal",
      })
      .where(eq(inboundMessages.id, matched.id));
    await recordStaffReply(db, {
      shopId: shop.id,
      personId: diver.id,
      inboundMessageId: matched.id,
      channel: "email",
      toAddress: "erased.diver@example.org",
      body: "Of course, we will lift you in from the platform.",
      locale: "en-US",
      sentByPersonId: owner.id,
      delivery: { status: "sent", providerMessageId: "ses-erase-1" },
      sentAt: new Date("2026-07-20T11:00:00.000Z"),
    });
    // A saved answer made from a reply to this diver, and one made from nobody's.
    await db.insert(inboxSavedAnswers).values([
      {
        shopId: shop.id,
        sourcePersonId: diver.id,
        title: "Of course",
        body: "Of course, we will lift you in from the platform.",
      },
      { shopId: shop.id, title: "Parking", body: "Park behind the shop." },
    ]);
    // A WhatsApp from before anybody linked the number to a record: person_id
    // null, reachable only by the address.
    await db.insert(inboundMessages).values({
      shopId: shop.id,
      personId: null,
      channel: "whatsapp",
      fromAddress: "13055550177",
      body: "hi it’s me from the reef trip",
      receivedAt: new Date("2026-07-19T10:00:00.000Z"),
      providerMessageId: "erase-2",
    });

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      actorPersonId: owner.id,
    });
    expect(erased.ok).toBe(true);

    const messages = await db
      .select({
        body: inboundMessages.body,
        subject: inboundMessages.subject,
        fromAddress: inboundMessages.fromAddress,
        assistTranslation: inboundMessages.assistTranslation,
      })
      .from(inboundMessages)
      .where(
        and(
          eq(inboundMessages.shopId, shop.id),
          // Both rows, by the ids they were filed under.
          eq(inboundMessages.providerMessageId, "erase-1"),
        ),
      );
    const [byNumber] = await db
      .select({ body: inboundMessages.body, fromAddress: inboundMessages.fromAddress })
      .from(inboundMessages)
      .where(eq(inboundMessages.providerMessageId, "erase-2"));
    const [reply] = await db
      .select({ body: staffReplies.body, toAddress: staffReplies.toAddress })
      .from(staffReplies)
      .where(eq(staffReplies.providerMessageId, "ses-erase-1"));

    expect(messages).toHaveLength(1);
    for (const row of messages) {
      expect(row.body).not.toContain("knee");
      expect(row.subject).toBeNull();
      expect(row.fromAddress).not.toContain("@");
      expect(row.assistTranslation).toBeNull();
    }
    expect(byNumber?.body).not.toContain("reef");
    expect(byNumber?.fromAddress).not.toBe("13055550177");
    expect(reply?.body).not.toContain("platform");
    expect(reply?.toAddress).not.toContain("@");

    // The saved answer copied from their reply goes with it; the shop's own stays.
    const saved = await db
      .select({ body: inboxSavedAnswers.body })
      .from(inboxSavedAnswers)
      .where(eq(inboxSavedAnswers.shopId, shop.id));
    expect(saved.map((row) => row.body)).not.toContain(
      "Of course, we will lift you in from the platform.",
    );
    expect(saved.map((row) => row.body)).toContain("Park behind the shop.");
  });
});
