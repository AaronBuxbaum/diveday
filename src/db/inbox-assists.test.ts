import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { REDACTED_TEXT } from "@/lib/anonymization";
import type { ClaudeProvider, ClaudeRequest } from "@/lib/claude/provider";
import { nowDate, nowMs } from "@/lib/clock";
import { formatShortDate } from "@/lib/format";
import { fileScopedShopContext } from "@/test/db";
import { fakeClaude, fakeClaudeMessage } from "@/test/fakes";
import { anonymizeDiver } from "./anonymize";
import { recordInboundMessage, recordStaffReply } from "./inbound-messages";
import {
  awaitsTriage,
  diverReplyLanguage,
  draftReplyFor,
  replyFacts,
  translateReplyFor,
  triageInboundMessage,
} from "./inbox-assists";
import { inboundMessages, people, personRoles, shops, trips } from "./schema";
import { setShopFeature, setShopReplyNotes } from "./shops";

const ctx = fileScopedShopContext();

// The seed shop is the canonical demo, and a demo is always dark; these
// tests are about a real shop running the assist through the fake provider.
beforeEach(async () => {
  await ctx.db.update(shops).set({ isDemo: false }).where(eq(shops.id, ctx.shop.id));
});

const keyed = { ANTHROPIC_API_KEY: "test-anthropic-key" };

function answering(value: unknown) {
  return fakeClaude({ reply: () => fakeClaudeMessage({ text: JSON.stringify(value) }) });
}

async function diverWithMessage(body: string, providerMessageId = `assist-${body.length}`) {
  const [diver] = await ctx.db
    .insert(people)
    .values({ shopId: ctx.shop.id, fullName: "Lena Vogel", email: "lena.vogel@example.org" })
    .returning({ id: people.id });
  if (!diver) throw new Error("fixture insert failed");
  await ctx.db.insert(personRoles).values({ personId: diver.id, role: "diver" });
  const recorded = await recordInboundMessage(ctx.db, {
    senderAuthenticated: true,
    shopId: ctx.shop.id,
    channel: "email",
    fromAddress: "lena.vogel@example.org",
    subject: "Samstag",
    body,
    receivedAt: new Date("2026-10-20T10:00:00.000Z"),
    providerMessageId,
  });
  if (recorded.status !== "recorded") throw new Error("not recorded");
  return { personId: diver.id, messageId: recorded.id };
}

async function stored(messageId: string) {
  const [row] = await ctx.db
    .select()
    .from(inboundMessages)
    .where(and(eq(inboundMessages.shopId, ctx.shop.id), eq(inboundMessages.id, messageId)));
  return row;
}

const triage = {
  intent: "question",
  urgent: false,
  language: "de",
  translation: "Is there room on Saturday?",
  confidence: 0.9,
};

describe("triageInboundMessage", () => {
  it("stores the tag and the translation on the message, once", async () => {
    const { messageId } = await diverWithMessage("Gibt es Platz am Samstag?");
    const provider = answering(triage);
    await triageInboundMessage(ctx.db, ctx.shop.id, messageId, { provider, env: keyed });
    expect(await stored(messageId)).toMatchObject({
      assistIntent: "question",
      assistUrgent: false,
      assistLanguage: "de",
      assistTranslation: "Is there room on Saturday?",
      assistTranslatedTo: "en-US",
    });
    expect((await stored(messageId))?.assistedAt).toBeInstanceOf(Date);
    // A second view does not ask again.
    await triageInboundMessage(ctx.db, ctx.shop.id, messageId, { provider, env: keyed });
    expect(provider.requests).toHaveLength(1);
  });

  it("sends the message's words and nothing about the diver", async () => {
    const { messageId } = await diverWithMessage("Gibt es Platz am Samstag?");
    const provider = answering(triage);
    await triageInboundMessage(ctx.db, ctx.shop.id, messageId, { provider, env: keyed });
    const sent = JSON.stringify(provider.requests[0] as ClaudeRequest);
    expect(sent).toContain("Gibt es Platz am Samstag?");
    expect(sent).not.toContain("lena.vogel@example.org");
    expect(sent).not.toContain("Lena Vogel");
  });

  it("marks a message read even when the answer was unusable, so it is not asked again", async () => {
    const { messageId } = await diverWithMessage("???");
    await triageInboundMessage(ctx.db, ctx.shop.id, messageId, {
      provider: answering({ ...triage, confidence: 0.1 }),
      env: keyed,
    });
    expect(await stored(messageId)).toMatchObject({ assistIntent: null, assistTranslation: null });
    expect((await stored(messageId))?.assistedAt).toBeInstanceOf(Date);
  });

  it("leaves the message untouched while the shop's assists are dark", async () => {
    const { messageId } = await diverWithMessage("Gibt es Platz am Samstag?");
    await setShopFeature(ctx.db, ctx.shop.id, "claudeSuggestions", false);
    const provider = answering(triage);
    await triageInboundMessage(ctx.db, ctx.shop.id, messageId, { provider, env: keyed });
    expect(provider.requests).toHaveLength(0);
    expect((await stored(messageId))?.assistedAt).toBeNull();
  });

  it("never reads a message flagged as spam, or another shop's", async () => {
    const { messageId } = await diverWithMessage("Gibt es Platz am Samstag?");
    await ctx.db
      .update(inboundMessages)
      .set({ spamFlagged: true })
      .where(eq(inboundMessages.id, messageId));
    const provider = answering(triage);
    await triageInboundMessage(ctx.db, ctx.shop.id, messageId, { provider, env: keyed });
    await triageInboundMessage(ctx.db, "00000000-0000-0000-0000-000000000000", messageId, {
      provider,
      env: keyed,
    });
    expect(provider.requests).toHaveLength(0);
  });

  it("skips a message the webhook could not authenticate, so a spoofed sender cannot spend the shop's cap", async () => {
    const { messageId } = await diverWithMessage("Gibt es Platz am Samstag?");
    await ctx.db
      .update(inboundMessages)
      .set({ senderAuthenticated: false })
      .where(eq(inboundMessages.id, messageId));
    const provider = answering(triage);
    await triageInboundMessage(ctx.db, ctx.shop.id, messageId, { provider, env: keyed });
    expect(provider.requests).toHaveLength(0);
    expect((await stored(messageId))?.assistedAt).toBeNull();
  });

  it("does not mark a message read when the call never happened, so a later view asks again", async () => {
    const { messageId } = await diverWithMessage("Gibt es Platz am Samstag?");
    const failing: ClaudeProvider = {
      async createMessage() {
        throw new Error("overloaded");
      },
    };
    await triageInboundMessage(ctx.db, ctx.shop.id, messageId, { provider: failing, env: keyed });
    expect((await stored(messageId))?.assistedAt).toBeNull();
    const provider = answering(triage);
    await triageInboundMessage(ctx.db, ctx.shop.id, messageId, { provider, env: keyed });
    expect(await stored(messageId)).toMatchObject({
      assistTranslation: "Is there room on Saturday?",
    });
  });

  it("writes nothing back when the diver was erased while the call was in flight", async () => {
    const { personId, messageId } = await diverWithMessage("Gibt es Platz am Samstag?");
    const [owner] = await ctx.db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, ctx.shop.id), eq(personRoles.role, "owner")));
    if (!owner) throw new Error("expected the seeded owner");
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let called: () => void = () => {};
    const asked = new Promise<void>((resolve) => {
      called = resolve;
    });
    const held: ClaudeProvider = {
      async createMessage() {
        called();
        await gate;
        return fakeClaudeMessage({ text: JSON.stringify(triage) });
      },
    };
    const pending = triageInboundMessage(ctx.db, ctx.shop.id, messageId, {
      provider: held,
      env: keyed,
    });
    await asked;
    const erased = await anonymizeDiver(ctx.db, {
      shopId: ctx.shop.id,
      personId,
      actorPersonId: owner.id,
    });
    expect(erased.ok).toBe(true);
    release();
    await pending;
    expect(await stored(messageId)).toMatchObject({
      body: REDACTED_TEXT,
      assistTranslation: null,
    });
  });
});

describe("awaitsTriage", () => {
  // The pages hand triage only these, so its per-view slots never go to a
  // message it would skip and leave unstamped (review of the assists, item 2).
  it.each([
    { name: "a plain message", set: {}, reads: true },
    { name: "an Ask to move", set: { channel: "page" as const }, reads: false },
    { name: "a keyword reply", set: { keywordIntent: "cancel" as const }, reads: false },
    { name: "spam", set: { spamFlagged: true }, reads: false },
    { name: "an unauthenticated sender", set: { senderAuthenticated: false }, reads: false },
    { name: "a blank body", set: { body: "   " }, reads: false },
  ])("agrees with what triage reads for $name", async ({ set, reads }) => {
    const { messageId } = await diverWithMessage("Gibt es Platz am Samstag?");
    if (Object.keys(set).length > 0) {
      await ctx.db.update(inboundMessages).set(set).where(eq(inboundMessages.id, messageId));
    }
    const before = await stored(messageId);
    if (!before) throw new Error("fixture row missing");
    expect(awaitsTriage(before)).toBe(reads);
    const provider = answering(triage);
    await triageInboundMessage(ctx.db, ctx.shop.id, messageId, { provider, env: keyed });
    expect(provider.requests).toHaveLength(reads ? 1 : 0);
    const read = await stored(messageId);
    if (!read) throw new Error("fixture row missing");
    expect(awaitsTriage(read)).toBe(false);
  });
});

describe("replyFacts", () => {
  it("quotes the shop's departures with their open seats and prices from the database", async () => {
    const { lines: facts } = await replyFacts(ctx.db, ctx.shop.id);
    expect(facts[0]).toContain(ctx.shop.name);
    expect(facts.some((line) => /seats open|full/.test(line))).toBe(true);
  });

  it("names the window and today's date in the shop's zone, apart from what a draft may quote", async () => {
    const [shop] = await ctx.db
      .select({ timezone: shops.timezone, locale: shops.defaultLocale })
      .from(shops)
      .where(eq(shops.id, ctx.shop.id));
    if (!shop) throw new Error("shop missing");
    const now = nowDate();
    const { window, lines } = await replyFacts(ctx.db, ctx.shop.id, now);
    expect(window).toContain(`Today is ${formatShortDate(now, shop.locale, shop.timezone)}`);
    expect(window).toContain(shop.timezone);
    expect(window).toContain("the next 14 days");
    expect(window).toContain("at most 30 departures");
    expect(lines.join("\n")).not.toContain("Today is");
  });

  it("says when the list stopped at its limit", async () => {
    const soon = new Date(nowMs() + 2 * 24 * 60 * 60 * 1000);
    await ctx.db.insert(trips).values(
      Array.from({ length: 31 }, (_, index) => ({
        shopId: ctx.shop.id,
        title: `Extra boat ${index}`,
        startsAt: new Date(soon.getTime() + index * 60_000),
        endsAt: new Date(soon.getTime() + index * 60_000 + 3 * 60 * 60 * 1000),
        capacity: 8,
      })),
    );
    const { window } = await replyFacts(ctx.db, ctx.shop.id);
    expect(window).toContain("The list stops at that limit");
  });

  it("ends with the shop's notes for replies, one line each, and leaves them out when there are none", async () => {
    const before = (await replyFacts(ctx.db, ctx.shop.id)).lines;
    expect(before).not.toContain("Notes from the shop:");
    await setShopReplyNotes(
      ctx.db,
      ctx.shop.id,
      "Park behind the shop by the tank racks. The gate opens at 7:15.\n\nWe rent 5mm wetsuits in every size.",
    );
    const { lines } = await replyFacts(ctx.db, ctx.shop.id);
    expect(lines.slice(-3)).toEqual([
      "Notes from the shop:",
      "Park behind the shop by the tank racks. The gate opens at 7:15.",
      "We rent 5mm wetsuits in every size.",
    ]);
  });

  it("never quotes a private charter or a rehearsal departure", async () => {
    const soon = new Date(nowMs() + 2 * 24 * 60 * 60 * 1000);
    const departure = (title: string, isPrivate: boolean, isRehearsal: boolean) => ({
      shopId: ctx.shop.id,
      title,
      startsAt: soon,
      endsAt: new Date(soon.getTime() + 3 * 60 * 60 * 1000),
      capacity: 8,
      isPrivate,
      isRehearsal,
      priceCents: 43_210,
    });
    await ctx.db
      .insert(trips)
      .values([
        departure("Okafor family charter", true, false),
        departure("Crew rehearsal run", true, true),
        departure("Open reef morning", false, false),
      ]);
    const facts = (await replyFacts(ctx.db, ctx.shop.id)).lines.join("\n");
    expect(facts).toContain("Open reef morning");
    expect(facts).not.toContain("Okafor family charter");
    expect(facts).not.toContain("Crew rehearsal run");
  });

  it("leaves out a rehearsal by its own flag, even one that is not private", async () => {
    // `trips_rehearsal_is_private` makes a public rehearsal impossible today.
    // This drops it inside the test's own transaction, which is rolled back,
    // so the read's `notRehearsal()` clause is tested on its own: if the
    // constraint ever goes, the clause still keeps a rehearsal out.
    await ctx.db.execute(sql`alter table trips drop constraint trips_rehearsal_is_private`);
    const soon = new Date(nowMs() + 2 * 24 * 60 * 60 * 1000);
    await ctx.db.insert(trips).values({
      shopId: ctx.shop.id,
      title: "Public rehearsal run",
      startsAt: soon,
      endsAt: new Date(soon.getTime() + 3 * 60 * 60 * 1000),
      capacity: 8,
      isPrivate: false,
      isRehearsal: true,
      priceCents: 43_210,
    });
    const facts = (await replyFacts(ctx.db, ctx.shop.id)).lines.join("\n");
    expect(facts).not.toContain("Public rehearsal run");
  });
});

describe("draftReplyFor", () => {
  it("drafts a reply that quotes only numbers the facts or the thread gave it", async () => {
    const { personId } = await diverWithMessage("Is there room for 2 on Saturday?");
    const { lines: facts } = await replyFacts(ctx.db, ctx.shop.id);
    const quoted = facts.find((line) => line.includes("seats open")) ?? facts[0] ?? "";
    const draft = await draftReplyFor(ctx.db, {
      shopId: ctx.shop.id,
      personId,
      provider: answering({
        reply: `Yes! ${quoted.replace(/^- /, "")}`,
        medical: false,
        eligibility: false,
        confidence: 0.9,
      }),
      env: keyed,
    });
    expect(draft).toContain(quoted.replace(/^- /, ""));
  });

  it("drafts from the shop's notes, so a time only the notes give may be quoted", async () => {
    await setShopReplyNotes(ctx.db, ctx.shop.id, "Park behind the shop. The gate opens at 7:15.");
    const { personId } = await diverWithMessage("Where do I park?");
    const draft = await draftReplyFor(ctx.db, {
      shopId: ctx.shop.id,
      personId,
      provider: answering({
        reply: "Park behind the shop. The gate opens at 7:15.",
        medical: false,
        eligibility: false,
        confidence: 0.9,
      }),
      env: keyed,
    });
    expect(draft).toBe("Park behind the shop. The gate opens at 7:15.");
  });

  it("throws a draft away when it names a price nobody gave it", async () => {
    const { personId } = await diverWithMessage("How much is a dive?");
    expect(
      await draftReplyFor(ctx.db, {
        shopId: ctx.shop.id,
        personId,
        provider: answering({
          reply: "It is 987654 dollars.",
          medical: false,
          eligibility: false,
          confidence: 0.9,
        }),
        env: keyed,
      }),
    ).toBeNull();
  });

  it("never drafts a reply that tells a diver they are qualified", async () => {
    const { personId } = await diverWithMessage(
      "I'm SSI Open Water. Can I do Saturday's wreck? It's 30 m right?",
    );
    expect(
      await draftReplyFor(ctx.db, {
        shopId: ctx.shop.id,
        personId,
        provider: answering({
          reply: "Yes, your Open Water card is fine for the wreck at 30 m.",
          medical: false,
          eligibility: true,
          confidence: 0.9,
        }),
        env: keyed,
      }),
    ).toBeNull();
  });

  it("never drafts an answer to a medical question", async () => {
    const { personId } = await diverWithMessage("I have asthma, can I dive?");
    expect(
      await draftReplyFor(ctx.db, {
        shopId: ctx.shop.id,
        personId,
        provider: answering({ reply: "Sure.", medical: true, eligibility: false, confidence: 0.9 }),
        env: keyed,
      }),
    ).toBeNull();
  });

  it("drafts nothing when the shop wrote last, and sends no address", async () => {
    const { personId, messageId } = await diverWithMessage("Thanks!");
    const provider = answering({
      reply: "You're welcome.",
      medical: false,
      eligibility: false,
      confidence: 0.9,
    });
    await recordStaffReply(ctx.db, {
      shopId: ctx.shop.id,
      personId,
      inboundMessageId: messageId,
      channel: "email",
      toAddress: "lena.vogel@example.org",
      body: "See you Saturday.",
      locale: "en-US",
      sentByPersonId: null,
      delivery: { status: "sent", providerMessageId: "ses-assist-1" },
      sentAt: new Date("2026-10-20T11:00:00.000Z"),
    });
    expect(
      await draftReplyFor(ctx.db, { shopId: ctx.shop.id, personId, provider, env: keyed }),
    ).toBeNull();
    expect(provider.requests).toHaveLength(0);
  });
});

describe("translateReplyFor", () => {
  it("translates into the language the diver last wrote in, and keeps every number", async () => {
    const { personId, messageId } = await diverWithMessage("Gibt es Platz am Samstag?");
    await triageInboundMessage(ctx.db, ctx.shop.id, messageId, {
      provider: answering(triage),
      env: keyed,
    });
    expect(await diverReplyLanguage(ctx.db, ctx.shop.id, personId)).toBe("de");
    const provider = answering({ translation: "Ja, um 8:00 Uhr." });
    expect(
      await translateReplyFor(ctx.db, {
        shopId: ctx.shop.id,
        personId,
        text: "Yes, at 8:00.",
        provider,
        env: keyed,
      }),
    ).toBe("Ja, um 8:00 Uhr.");
    expect(JSON.stringify(provider.requests[0])).toContain("Language: de");
  });

  it("offers nothing for a diver who writes in the shop's language", async () => {
    const { personId, messageId } = await diverWithMessage("Any room Saturday?");
    await triageInboundMessage(ctx.db, ctx.shop.id, messageId, {
      provider: answering({ ...triage, language: "en", translation: null }),
      env: keyed,
    });
    expect(await diverReplyLanguage(ctx.db, ctx.shop.id, personId)).toBeNull();
  });
});
