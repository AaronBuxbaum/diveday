import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { INTEREST_REPLY_DAILY_CAP, INTEREST_REPLY_MAX } from "@/lib/interest-reply";
import { fileScopedShopContext } from "@/test/db";
import { fakeCourtesy, fakeEmail, fakeSms } from "@/test/fakes";
import { anonymizeDiver } from "./anonymize";
import type { AppDb } from "./client";
import { createDiver } from "./divers";
import { addInterest, interestRow, ownerId } from "./interest-dates-fixtures";
import { sendInterestReply } from "./interest-replies";
import { setDateInterestOutcome } from "./interests";
import { interestReplies, interests, shops } from "./schema";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`). A real shop, so mail is not held
// as a demo shop's would be.
const ctx = fileScopedShopContext({ realShop: true });
const now = new Date("2031-04-01T12:00:00.000Z");

async function repliesTo(db: AppDb, interestId: string) {
  return db.select().from(interestReplies).where(eq(interestReplies.interestId, interestId));
}

/** The seeded shop, a staffer to send as, and one open date request. */
async function openRequest(contact: { email?: string | null; phone?: string | null }) {
  const { db, shop } = ctx;
  const id = await addInterest(db, shop.id, {
    interest: "Two-tank reef",
    name: "Priya Sharma",
    preferredDate: "2031-05-03",
    email: contact.email ?? null,
    phone: contact.phone ?? null,
  });
  return { db, shop, id, staff: await ownerId(db, shop.id) };
}

describe("sendInterestReply", () => {
  it("emails the address the request left, records the send, and closes it as replied", async () => {
    const { db, shop, id, staff } = await openRequest({ email: "priya@example.com" });
    const email = fakeEmail();
    const result = await sendInterestReply(
      db,
      {
        shopId: shop.id,
        interestId: id,
        body: "  We can run the 3rd.\r\n\r\nSee you at 8.  ",
        sentByPersonId: staff,
        now,
      },
      { emailProvider: email.provider },
    );

    expect(result).toMatchObject({ status: "sent", channel: "email" });
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]).toMatchObject({
      kind: "staff_reply",
      to: "priya@example.com",
      body: "We can run the 3rd.\n\nSee you at 8.",
    });
    expect(await interestRow(db, id)).toMatchObject({ closedAs: "replied", closedAt: now });
    expect(await repliesTo(db, id)).toEqual([
      expect.objectContaining({
        shopId: shop.id,
        channel: "email",
        toAddress: "priya@example.com",
        body: "We can run the 3rd.\n\nSee you at 8.",
        sentByPersonId: staff,
        status: "sent",
        providerMessageId: "em_1",
        sentAt: now,
      }),
    ]);
  });

  it("texts the number when there is no email, folded to one line under the shop's name", async () => {
    const { db, shop, id, staff } = await openRequest({ phone: "+1 (305) 555-0134" });
    const sms = fakeSms();
    const result = await sendInterestReply(
      db,
      { shopId: shop.id, interestId: id, body: "Yes!\nThe 3rd works.", sentByPersonId: staff, now },
      { smsProvider: sms.provider, whatsAppProviders: new Map() },
    );
    expect(result).toMatchObject({ status: "sent", channel: "sms" });
    expect(sms.sent).toHaveLength(1);
    expect(sms.sent[0]?.to).toBe("+13055550134");
    expect(sms.sent[0]?.body).toMatch(new RegExp(`^${shop.name}: Yes! The 3rd works\\. `));
    expect(await repliesTo(db, id)).toEqual([
      expect.objectContaining({
        channel: "sms",
        toAddress: "+13055550134",
        body: "Yes! The 3rd works.",
      }),
    ]);
  });

  it("reads a national number against the shop's own country", async () => {
    const { db, shop, id, staff } = await openRequest({ phone: "305 555 0134" });
    const sms = fakeSms();
    await sendInterestReply(
      db,
      { shopId: shop.id, interestId: id, body: "See you then.", sentByPersonId: staff, now },
      { smsProvider: sms.provider, whatsAppProviders: new Map() },
    );
    expect(sms.sent[0]?.to).toBe("+13055550134");
  });

  it("goes on the shop's WhatsApp when it has connected one", async () => {
    const { db, shop, id, staff } = await openRequest({ phone: "+13055550134" });
    const whatsapp = fakeCourtesy();
    const sms = fakeSms();
    const result = await sendInterestReply(
      db,
      { shopId: shop.id, interestId: id, body: "See you then.", sentByPersonId: staff, now },
      { smsProvider: sms.provider, whatsAppProviders: new Map([[shop.id, whatsapp.provider]]) },
    );
    expect(result).toMatchObject({ status: "sent", channel: "whatsapp" });
    expect(sms.sent).toEqual([]);
    expect(whatsapp.sent).toHaveLength(1);
  });

  it("refuses a request with no address and no readable number, sending nothing", async () => {
    const { db, shop, id, staff } = await openRequest({ phone: "call the hotel" });
    const sms = fakeSms();
    const email = fakeEmail();
    expect(
      await sendInterestReply(
        db,
        { shopId: shop.id, interestId: id, body: "Hello", sentByPersonId: staff, now },
        { emailProvider: email.provider, smsProvider: sms.provider, whatsAppProviders: new Map() },
      ),
    ).toEqual({ status: "refused", reason: "no_route" });
    expect(sms.sent).toEqual([]);
    expect(email.sent).toEqual([]);
    expect(await interestRow(db, id)).toMatchObject({ closedAt: null, closedAs: null });
  });

  it("refuses an empty reply and one over the limit, and takes one at the limit", async () => {
    const { db, shop, id, staff } = await openRequest({ email: "priya@example.com" });
    const email = fakeEmail();
    const send = (body: string) =>
      sendInterestReply(
        db,
        { shopId: shop.id, interestId: id, body, sentByPersonId: staff, now },
        { emailProvider: email.provider },
      );
    expect(await send(" \n\t ")).toEqual({ status: "refused", reason: "empty" });
    expect(await send("x".repeat(INTEREST_REPLY_MAX + 1))).toEqual({
      status: "refused",
      reason: "too_long",
    });
    expect(email.sent).toEqual([]);
    expect(await send("x".repeat(INTEREST_REPLY_MAX))).toMatchObject({ status: "sent" });
  });

  it("records a reply that did not go, leaves the request open, and sends on the next try", async () => {
    const { db, shop, id, staff } = await openRequest({ email: "priya@example.com" });
    const failing = fakeEmail({ status: "failed", errorCode: "provider_down", retryable: true });
    const first = await sendInterestReply(
      db,
      { shopId: shop.id, interestId: id, body: "Hello", sentByPersonId: staff, now },
      { emailProvider: failing.provider },
    );
    expect(first).toMatchObject({ status: "failed", channel: "email", reason: "send_failed" });
    expect(await interestRow(db, id)).toMatchObject({ closedAt: null, closedAs: null });
    expect(await repliesTo(db, id)).toEqual([
      expect.objectContaining({ status: "failed", sendErrorCode: "provider_down" }),
    ]);

    const ok = fakeEmail();
    const later = new Date(now.getTime() + 60_000);
    expect(
      await sendInterestReply(
        db,
        { shopId: shop.id, interestId: id, body: "Hello", sentByPersonId: staff, now: later },
        { emailProvider: ok.provider },
      ),
    ).toMatchObject({ status: "sent" });
    expect(await interestRow(db, id)).toMatchObject({ closedAs: "replied", closedAt: later });
    expect((await repliesTo(db, id)).map((row) => row.status).sort()).toEqual(["failed", "sent"]);
  });

  it("names a channel that is not switched on as not configured", async () => {
    const { db, shop, id, staff } = await openRequest({ email: "priya@example.com" });
    const off = fakeEmail({ status: "not_configured" });
    expect(
      await sendInterestReply(
        db,
        { shopId: shop.id, interestId: id, body: "Hello", sentByPersonId: staff, now },
        { emailProvider: off.provider },
      ),
    ).toMatchObject({ status: "failed", reason: "not_configured" });
    expect(await interestRow(db, id)).toMatchObject({ closedAt: null });
  });

  it("sends one reply when two staffers press Send: the second finds it closed", async () => {
    const { db, shop, id, staff } = await openRequest({ email: "priya@example.com" });
    const email = fakeEmail();
    const send = () =>
      sendInterestReply(
        db,
        { shopId: shop.id, interestId: id, body: "Hello", sentByPersonId: staff, now },
        { emailProvider: email.provider },
      );
    expect(await send()).toMatchObject({ status: "sent" });
    expect(await send()).toEqual({ status: "refused", reason: "not_open" });
    expect(email.sent).toHaveLength(1);
  });

  /**
   * **Reopen does not re-arm a lead without end** (security review of #2555):
   * reply, Reopen, reply again is refused past the cap in a day, whether the
   * attempts went or not, before the request is claimed or a provider reached.
   */
  it("stops replying to one request after the day's cap, however often it is reopened", async () => {
    const { db, shop, id, staff } = await openRequest({ phone: "+13055550134" });
    const sms = fakeSms();
    const reply = (at: Date) =>
      sendInterestReply(
        db,
        { shopId: shop.id, interestId: id, body: "Hello", sentByPersonId: staff, now: at },
        { smsProvider: sms.provider, whatsAppProviders: new Map() },
      );
    for (let n = 0; n < INTEREST_REPLY_DAILY_CAP; n += 1) {
      const at = new Date(now.getTime() + n * 60_000);
      expect(await reply(at)).toMatchObject({ status: "sent" });
      await setDateInterestOutcome(db, { shopId: shop.id, interestId: id, outcome: null, now: at });
    }
    const past = new Date(now.getTime() + INTEREST_REPLY_DAILY_CAP * 60_000);
    expect(await reply(past)).toEqual({ status: "refused", reason: "capped" });
    expect(sms.sent).toHaveLength(INTEREST_REPLY_DAILY_CAP);
    expect(await interestRow(db, id)).toMatchObject({ closedAt: null, closedAs: null });
    expect(await repliesTo(db, id)).toHaveLength(INTEREST_REPLY_DAILY_CAP);
    // A day after the first, the window has moved on.
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60_000 + 1);
    expect(await reply(tomorrow)).toMatchObject({ status: "sent" });
  });

  it("refuses a request already closed by a tick, and leaves its close alone", async () => {
    const { db, shop, id, staff } = await openRequest({ email: "priya@example.com" });
    await setDateInterestOutcome(db, { shopId: shop.id, interestId: id, outcome: "done", now });
    const email = fakeEmail();
    expect(
      await sendInterestReply(
        db,
        { shopId: shop.id, interestId: id, body: "Hello", sentByPersonId: staff, now },
        { emailProvider: email.provider },
      ),
    ).toEqual({ status: "refused", reason: "not_open" });
    expect(email.sent).toEqual([]);
    expect(await interestRow(db, id)).toMatchObject({ closedAs: "done" });
  });

  /**
   * **Shop A's staff cannot answer shop B's lead.** The action passes the
   * session's shop; an id from another shop is "not found", nothing is sent and
   * nothing about that request moves.
   */
  it("never reaches another shop's request, in either direction", async () => {
    const { db, shop, id, staff } = await openRequest({ email: "priya@example.com" });
    const [rival] = await db
      .insert(shops)
      .values({ name: "Rival Reef", slug: "rival-reef-2555", timezone: "America/New_York" })
      .returning();
    if (!rival) throw new Error("rival shop insert failed");
    const rivalLead = await addInterest(db, rival.id, {
      interest: "Wreck dive",
      email: "rival-lead@example.com",
    });
    const email = fakeEmail();

    // Shop A's session, shop B's request id.
    expect(
      await sendInterestReply(
        db,
        { shopId: shop.id, interestId: rivalLead, body: "Hello", sentByPersonId: staff, now },
        { emailProvider: email.provider },
      ),
    ).toEqual({ status: "refused", reason: "not_found" });
    // Shop B's session, shop A's request id.
    expect(
      await sendInterestReply(
        db,
        { shopId: rival.id, interestId: id, body: "Hello", sentByPersonId: staff, now },
        { emailProvider: email.provider },
      ),
    ).toEqual({ status: "refused", reason: "not_found" });
    expect(email.sent).toEqual([]);
    expect(await interestRow(db, rivalLead)).toMatchObject({ closedAt: null });
    expect(await interestRow(db, id)).toMatchObject({ closedAt: null });
    expect(await repliesTo(db, rivalLead)).toEqual([]);
  });

  it("answers only a date request, never a last-minute interest or an unknown id", async () => {
    const { db, shop, staff } = await openRequest({ email: "priya@example.com" });
    const diver = await createDiver(db, {
      shopId: shop.id,
      fullName: "Anytime Ana",
      email: "ana@example.com",
    });
    if (!diver) throw new Error("diver insert failed");
    const [anytime] = await db
      .insert(interests)
      .values({
        shopId: shop.id,
        scope: "anytime",
        askedBy: "diver",
        personId: diver.id,
        email: "ana@example.com",
      })
      .returning({ id: interests.id });
    if (!anytime) throw new Error("anytime insert failed");
    const email = fakeEmail();
    for (const interestId of [anytime.id, crypto.randomUUID()]) {
      expect(
        await sendInterestReply(
          db,
          { shopId: shop.id, interestId, body: "Hello", sentByPersonId: staff, now },
          { emailProvider: email.provider },
        ),
      ).toEqual({ status: "refused", reason: "not_found" });
    }
    expect(email.sent).toEqual([]);
  });

  it("refuses a body over the limit at the database too", async () => {
    const { db, shop, id, staff } = await openRequest({ email: "priya@example.com" });
    await expect(
      db.insert(interestReplies).values({
        shopId: shop.id,
        interestId: id,
        channel: "email",
        toAddress: "priya@example.com",
        body: "x".repeat(INTEREST_REPLY_MAX + 1),
        locale: "en-US",
        sentByPersonId: staff,
        status: "sent",
        sentAt: now,
      }),
    ).rejects.toThrow();
  });

  it("is blanked by the diver's erasure: the reply stays on record, the address and words go", async () => {
    const { db, shop, id, staff } = await openRequest({ email: "rhea@example.com" });
    const diver = await createDiver(db, {
      shopId: shop.id,
      fullName: "Removed Rhea",
      email: "rhea@example.com",
    });
    if (!diver) throw new Error("diver insert failed");
    await sendInterestReply(
      db,
      { shopId: shop.id, interestId: id, body: "Rhea, the 3rd works.", sentByPersonId: staff, now },
      { emailProvider: fakeEmail().provider },
    );
    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      actorPersonId: staff,
    });
    if (!erased.ok) throw new Error(`erasure refused: ${erased.reason}`);
    expect(await repliesTo(db, id)).toEqual([
      expect.objectContaining({
        status: "sent",
        sentByPersonId: staff,
        toAddress: null,
        body: null,
        providerMessageId: null,
      }),
    ]);
  });

  describe("a quote for a private charter (loop 5, row 11)", () => {
    async function charterRequest() {
      const { db, shop } = ctx;
      const id = await addInterest(db, shop.id, {
        interest: "The whole boat for six",
        name: "Priya Sharma",
        preferredDate: "2031-05-03",
        email: "priya@example.com",
        charter: true,
      });
      return { db, shop, id, staff: await ownerId(db, shop.id) };
    }

    it("puts the quote first, in the shop's currency, and records it once the reply goes", async () => {
      const { db, shop, id, staff } = await charterRequest();
      const [{ currency }] = await db
        .select({ currency: shops.currency })
        .from(shops)
        .where(eq(shops.id, shop.id));
      const email = fakeEmail();
      const result = await sendInterestReply(
        db,
        {
          shopId: shop.id,
          interestId: id,
          body: "The 3rd works.",
          quoteCents: 180_000,
          sentByPersonId: staff,
          now,
        },
        { emailProvider: email.provider },
      );
      expect(result).toMatchObject({ status: "sent" });
      const sent = email.sent[0];
      const body = sent?.kind === "staff_reply" ? sent.body : "";
      expect(body.split("\n\n")[1]).toBe("The 3rd works.");
      expect(body.split("\n\n")[0]).toMatch(/1,800/);
      expect(await interestRow(db, id)).toMatchObject({
        charterQuoteCents: 180_000,
        charterQuoteCurrency: currency,
        charterQuotedAt: now,
        charterQuotedByPersonId: staff,
      });
    });

    it("records no quote when the reply does not go", async () => {
      const { db, shop, id, staff } = await charterRequest();
      const result = await sendInterestReply(
        db,
        {
          shopId: shop.id,
          interestId: id,
          body: "Yes.",
          quoteCents: 90_000,
          sentByPersonId: staff,
          now,
        },
        { emailProvider: fakeEmail({ status: "failed", errorCode: "boom" }).provider },
      );
      expect(result).toMatchObject({ status: "failed" });
      expect(await interestRow(db, id)).toMatchObject({
        charterQuoteCents: null,
        charterQuotedAt: null,
      });
    });

    it("refuses a quote on a request that is not a charter, or one that is not an amount", async () => {
      const plain = await openRequest({ email: "priya@example.com" });
      const email = fakeEmail();
      expect(
        await sendInterestReply(
          plain.db,
          {
            shopId: plain.shop.id,
            interestId: plain.id,
            body: "Yes.",
            quoteCents: 90_000,
            sentByPersonId: plain.staff,
            now,
          },
          { emailProvider: email.provider },
        ),
      ).toEqual({ status: "refused", reason: "quote_not_a_charter" });
      const charter = await charterRequest();
      for (const bad of [0, -5, 1.5, Number.NaN, 10_000_001]) {
        expect(
          await sendInterestReply(
            charter.db,
            {
              shopId: charter.shop.id,
              interestId: charter.id,
              body: "Yes.",
              quoteCents: bad,
              sentByPersonId: charter.staff,
              now,
            },
            { emailProvider: email.provider },
          ),
        ).toEqual({ status: "refused", reason: "bad_quote" });
      }
      expect(email.sent).toHaveLength(0);
      expect(await interestRow(charter.db, charter.id)).toMatchObject({ closedAt: null });
    });
  });
});
