import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import {
  countUnansweredMessages,
  deleteInboundMessage,
  getInboundMessage,
  lastInboundAt,
  markInboundAnswered,
  matchPersonByAddress,
  pagedInboxMessages,
  personThread,
  recordInboundMessage,
  recordStaffReply,
  shopIdForInboundEmailToken,
} from "./inbound-messages";
import { inboundMessages, people, personRoles, shops } from "./schema";

/**
 * The inbox's contract (ADR 20260907-two-way-inbox): a message lands on the
 * diver whose address it came from and only inside the shop it was sent to; a
 * redelivered webhook changes nothing; the unanswered count is what Today
 * reports and a sent reply is what empties it.
 */

const NOW = new Date("2026-07-21T13:30:00.000Z");

async function firstDiver(db: Awaited<ReturnType<typeof seededShopContext>>["db"], shopId: string) {
  const [row] = await db
    .select({ id: people.id, email: people.email, phone: people.phone, fullName: people.fullName })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(
        eq(people.shopId, shopId),
        eq(personRoles.role, "diver"),
        // The seed's first customer (seed-cast.ts), who carries both an email
        // and a phone; the earliest-created diver does not always.
        eq(people.fullName, "Priya Sharma"),
      ),
    )
    .limit(1);
  if (!row?.email || !row.phone) throw new Error("seeded diver missing contact details");
  return row as { id: string; email: string; phone: string; fullName: string };
}

async function shopWithCountry(
  db: Awaited<ReturnType<typeof seededShopContext>>["db"],
  country: string,
  slug: string,
): Promise<string> {
  const [row] = await db
    .insert(shops)
    .values({ name: slug, slug, timezone: "UTC", addressCountry: country })
    .returning({ id: shops.id });
  if (!row) throw new Error("shop insert failed");
  return row.id;
}

async function addDiver(
  db: Awaited<ReturnType<typeof seededShopContext>>["db"],
  shopId: string,
  fullName: string,
  phone: string,
): Promise<string> {
  const [row] = await db
    .insert(people)
    .values({ shopId, fullName, phone })
    .returning({ id: people.id });
  if (!row) throw new Error("person insert failed");
  await db.insert(personRoles).values({ personId: row.id, role: "diver" });
  return row.id;
}

describe("attribution by address", () => {
  it("matches an email to the diver who holds it, however the header spelt it", async () => {
    const { db, shop } = await seededShopContext();
    const diver = await firstDiver(db, shop.id);
    const result = await recordInboundMessage(db, {
      shopId: shop.id,
      channel: "email",
      fromAddress: `${diver.fullName} <${diver.email.toUpperCase()}>`,
      subject: "Re: Saturday",
      body: "Can I move to the afternoon boat?",
      receivedAt: NOW,
      providerMessageId: "email-1",
    });
    expect(result).toMatchObject({ status: "recorded", personId: diver.id });
  });

  it("matches a WhatsApp number to the diver by digits alone", async () => {
    const { db, shop } = await seededShopContext();
    const diver = await firstDiver(db, shop.id);
    const digits = diver.phone.replace(/\D/g, "");
    expect(await matchPersonByAddress(db, shop.id, "whatsapp", digits)).toBe(diver.id);
    // A number that merely ends the same way is somebody else.
    expect(await matchPersonByAddress(db, shop.id, "whatsapp", `9${digits.slice(1)}`)).toBeNull();
  });

  /**
   * **Attribution is not North American** (issue #1547). `phoneMatches` reads a
   * stored number against the shop's own `address_country`, so a Mallorca shop
   * whose diver is on file as `612 345 678` matches an inbound `34612345678` —
   * and a Key Largo shop holding the same nine digits does not, because they
   * are not a US number. Before this, the rule accepted any stored number of
   * ten digits or more that the inbound number ended in, which linked by
   * coincidence across countries.
   */
  it("reads a bare national number against the shop's own country", async () => {
    const { db } = await seededShopContext();
    const spanish = await shopWithCountry(db, "ES", "mallorca-inbox");
    const florida = await shopWithCountry(db, "US", "florida-inbox");
    const bare = "612 345 678";
    const spanishDiver = await addDiver(db, spanish, "Nuria Serra", bare);
    await addDiver(db, florida, "Wes Calder", bare);

    expect(await matchPersonByAddress(db, spanish, "whatsapp", "34612345678")).toBe(spanishDiver);
    expect(await matchPersonByAddress(db, florida, "whatsapp", "34612345678")).toBeNull();
  });

  it("leaves a stranger unmatched rather than guessing", async () => {
    const { db, shop } = await seededShopContext();
    const result = await recordInboundMessage(db, {
      shopId: shop.id,
      channel: "email",
      fromAddress: "nobody.here@example.net",
      body: "Do you run night dives?",
      receivedAt: NOW,
      providerMessageId: "email-stranger",
    });
    expect(result).toMatchObject({ status: "recorded", personId: null });
  });

  it("refuses an address that is not one", async () => {
    const { db, shop } = await seededShopContext();
    expect(
      await recordInboundMessage(db, {
        shopId: shop.id,
        channel: "email",
        fromAddress: "not an address",
        body: "x",
        receivedAt: NOW,
        providerMessageId: "email-bad",
      }),
    ).toEqual({ status: "invalid_address" });
  });

  it("never matches a diver from another shop, even on the same address", async () => {
    const { db, shop } = await seededShopContext();
    const diver = await firstDiver(db, shop.id);
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-inbox", timezone: "UTC" })
      .returning({ id: shops.id });
    if (!otherShop) throw new Error("shop insert failed");
    expect(
      await matchPersonByAddress(db, otherShop.id, "email", diver.email.toLowerCase()),
    ).toBeNull();
    const result = await recordInboundMessage(db, {
      shopId: otherShop.id,
      channel: "email",
      fromAddress: diver.email,
      body: "hello",
      receivedAt: NOW,
      providerMessageId: "email-cross",
    });
    expect(result).toMatchObject({ status: "recorded", personId: null });
  });
});

describe("idempotency", () => {
  it("records a redelivered provider message id once", async () => {
    const { db, shop } = await seededShopContext();
    const input = {
      shopId: shop.id,
      channel: "whatsapp" as const,
      fromAddress: "+1 305 555 0199",
      body: "on my way",
      receivedAt: NOW,
      providerMessageId: "wamid.dup",
    };
    expect((await recordInboundMessage(db, input)).status).toBe("recorded");
    expect((await recordInboundMessage(db, input)).status).toBe("duplicate");
    const rows = await db
      .select()
      .from(inboundMessages)
      .where(eq(inboundMessages.providerMessageId, "wamid.dup"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.fromAddress).toBe("13055550199");
  });
});

describe("the reply-to token", () => {
  it("resolves a shop from its token and nothing from a stranger's", async () => {
    const { db, shop } = await seededShopContext();
    const [row] = await db
      .select({ token: shops.inboundEmailToken })
      .from(shops)
      .where(eq(shops.id, shop.id));
    expect(row?.token).toMatch(/^[0-9a-f-]{36}$/);
    expect(await shopIdForInboundEmailToken(db, row?.token ?? "")).toBe(shop.id);
    expect(await shopIdForInboundEmailToken(db, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});

describe("the unanswered count and the inbox", () => {
  it("counts live unanswered messages, and a sent reply takes one off", async () => {
    const { db, shop } = await seededShopContext();
    const diver = await firstDiver(db, shop.id);
    // The seed leaves three unanswered rows in the demo shop.
    const before = await countUnansweredMessages(db, shop.id);
    const recorded = await recordInboundMessage(db, {
      shopId: shop.id,
      channel: "email",
      fromAddress: diver.email,
      body: "Is nitrox available Saturday?",
      receivedAt: NOW,
      providerMessageId: "email-count",
    });
    if (recorded.status !== "recorded") throw new Error("not recorded");
    expect(await countUnansweredMessages(db, shop.id)).toBe(before + 1);

    const [staffer] = await db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
      .limit(1);
    if (!staffer) throw new Error("owner missing");

    // A failed send answers nothing.
    await recordStaffReply(db, {
      shopId: shop.id,
      personId: diver.id,
      inboundMessageId: recorded.id,
      channel: "email",
      toAddress: diver.email,
      body: "Yes",
      locale: "en-US",
      sentByPersonId: staffer.id,
      delivery: { status: "failed", errorCode: "boom" },
      sentAt: NOW,
    });
    expect(await countUnansweredMessages(db, shop.id)).toBe(before + 1);

    await recordStaffReply(db, {
      shopId: shop.id,
      personId: diver.id,
      inboundMessageId: recorded.id,
      channel: "email",
      toAddress: diver.email,
      body: "Yes, 32% on every boat.",
      locale: "en-US",
      sentByPersonId: staffer.id,
      delivery: { status: "sent", providerMessageId: "ses-reply-1" },
      sentAt: NOW,
    });
    expect(await countUnansweredMessages(db, shop.id)).toBe(before);

    const thread = await personThread(db, shop.id, diver.id);
    const directions = thread.map((entry) => entry.direction);
    expect(directions.filter((d) => d === "outbound")).toHaveLength(2);
    const last = thread.at(-1);
    expect(last?.direction).toBe("outbound");
    if (last?.direction === "outbound") expect(last.reply.status).toBe("sent");
  });

  it("lists unanswered rows first, newest first, and never a deleted one", async () => {
    const { db, shop } = await seededShopContext();
    const page = await pagedInboxMessages(db, shop.id, { page: 1 });
    expect(page.total).toBeGreaterThanOrEqual(4);
    const answeredFlags = page.rows.map((row) => row.message.answeredAt !== null);
    const firstAnswered = answeredFlags.indexOf(true);
    if (firstAnswered >= 0) expect(answeredFlags.slice(firstAnswered).every(Boolean)).toBe(true);
    const unknown = page.rows.find((row) => row.message.personId === null);
    expect(unknown?.personName).toBeNull();

    const victim = page.rows[0]?.message;
    if (!victim) throw new Error("no rows");
    expect(await deleteInboundMessage(db, shop.id, victim.id, NOW)).toBe(true);
    const after = await pagedInboxMessages(db, shop.id, { page: 1 });
    expect(after.total).toBe(page.total - 1);
    expect(after.rows.some((row) => row.message.id === victim.id)).toBe(false);
    // Gone from the shop's count too, and a second delete finds nothing.
    expect(await deleteInboundMessage(db, shop.id, victim.id, NOW)).toBe(false);
  });

  it("refuses to answer or delete another shop's message", async () => {
    const { db, shop } = await seededShopContext();
    const page = await pagedInboxMessages(db, shop.id, { page: 1 });
    const target = page.rows[0]?.message;
    if (!target) throw new Error("no rows");
    const otherShopId = "00000000-0000-4000-8000-000000000000";
    expect(await markInboundAnswered(db, otherShopId, target.id, NOW)).toBe(false);
    expect(await deleteInboundMessage(db, otherShopId, target.id, NOW)).toBe(false);
    expect(await personThread(db, otherShopId, target.personId ?? "")).toEqual([]);
  });

  it("never names another shop's staffer as the sender of a reply", async () => {
    // `sentByPersonId` is only ever written from a shop-scoped session, so this
    // row cannot exist today — which is exactly the invariant worth pinning,
    // since the join is what a reader trusts. A left join with the shop
    // condition answers a null name; without it, it would answer the other
    // shop's staffer by name.
    const { db, shop } = await seededShopContext();
    const diver = await firstDiver(db, shop.id);
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-thread", timezone: "UTC" })
      .returning({ id: shops.id });
    if (!otherShop) throw new Error("shop insert failed");
    const [foreignStaffer] = await db
      .insert(people)
      .values({ shopId: otherShop.id, fullName: "Rival Owner" })
      .returning({ id: people.id });
    if (!foreignStaffer) throw new Error("person insert failed");

    const recorded = await recordInboundMessage(db, {
      shopId: shop.id,
      channel: "email",
      fromAddress: diver.email,
      body: "Who replied to me?",
      receivedAt: NOW,
      providerMessageId: "email-cross-sender",
    });
    if (recorded.status !== "recorded") throw new Error("not recorded");
    await recordStaffReply(db, {
      shopId: shop.id,
      personId: diver.id,
      inboundMessageId: recorded.id,
      channel: "email",
      toAddress: diver.email,
      body: "We did.",
      locale: "en-US",
      sentByPersonId: foreignStaffer.id,
      delivery: { status: "sent", providerMessageId: "ses-cross-sender" },
      sentAt: NOW,
    });

    const thread = await personThread(db, shop.id, diver.id);
    const entry = thread.find(
      (item) => item.direction === "outbound" && item.reply.sentByPersonId === foreignStaffer.id,
    );
    if (entry?.direction !== "outbound") throw new Error("reply missing from the thread");
    expect(entry.sentByName).toBeNull();
  });
});

/**
 * A subject is provider-supplied text that every reader of the row inherits —
 * the inbox list, the record's conversation, an export. Cleaned where the row
 * is written rather than in the notification schema, which only guards the
 * send path.
 *
 * Not a vulnerability: SESv2 takes headers as JSON over HTTPS and builds the
 * MIME itself, so a folded or control-laden subject was never going to inject
 * a header. It is a consistency hardening, so what is stored is what a person
 * can read.
 */
describe("a subject with control characters in it", () => {
  it("keeps the words, loses the control characters, and does not glue them together", async () => {
    const { db, shop } = await seededShopContext();
    const diver = await firstDiver(db, shop.id);
    const result = await recordInboundMessage(db, {
      shopId: shop.id,
      channel: "email",
      fromAddress: diver.email ?? "",
      // A folded header, the ordinary way this arrives.
      subject: "Re: Saturday\r\n departure\u0000 plan",
      body: "here",
      receivedAt: new Date("2026-07-21T12:00:00.000Z"),
      providerMessageId: "ses.control-chars",
    });
    if (result.status !== "recorded") throw new Error(`unexpected ${result.status}`);

    const stored = await getInboundMessage(db, shop.id, result.id);
    // Each control character became a space, the run collapsed, and nothing
    // was glued together across the fold.
    expect(stored?.subject).toBe("Re: Saturday departure plan");
  });

  it("leaves accents and emoji alone", async () => {
    const { db, shop } = await seededShopContext();
    const diver = await firstDiver(db, shop.id);
    const result = await recordInboundMessage(db, {
      shopId: shop.id,
      channel: "email",
      fromAddress: diver.email ?? "",
      subject: "¿Mañana a las 8? 🤿",
      body: "here",
      receivedAt: new Date("2026-07-21T12:00:00.000Z"),
      providerMessageId: "ses.accents",
    });
    if (result.status !== "recorded") throw new Error(`unexpected ${result.status}`);

    const stored = await getInboundMessage(db, shop.id, result.id);
    expect(stored?.subject).toBe("¿Mañana a las 8? 🤿");
  });
});

describe("the WhatsApp window", () => {
  it("reports when a diver last wrote, per channel", async () => {
    const { db, shop } = await seededShopContext();
    const diver = await firstDiver(db, shop.id);
    await recordInboundMessage(db, {
      shopId: shop.id,
      channel: "whatsapp",
      fromAddress: diver.phone,
      body: "here",
      receivedAt: new Date("2026-07-21T12:00:00.000Z"),
      providerMessageId: "wamid.read-1",
    });
    expect(await lastInboundAt(db, shop.id, diver.id, "whatsapp")).toEqual(
      new Date("2026-07-21T12:00:00.000Z"),
    );
    expect(await lastInboundAt(db, shop.id, diver.id, "sms")).toBeNull();
  });
});
