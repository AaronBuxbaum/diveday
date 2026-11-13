import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { recordInboundMessage, recordStaffReply } from "../../db/inbound-messages";
import { inboundMessages, people, personRoles, shops, trips } from "../../db/schema/index";
import { setShopFeature, setShopReplyNotes } from "../../db/shops";
import type { ClaudeProvider, ClaudeRequest } from "../../lib/claude/provider";
import { nowDate, nowMs } from "../../lib/clock";
import { formatShortDate } from "../../lib/format";
import { fileScopedShopContext } from "../../test/db";
import { fakeClaude, fakeClaudeMessage } from "../../test/fakes";
import { REDACTED_TEXT } from "../anonymization/rules";
import { anonymizeDiver } from "../anonymize/store";
import {
  awaitsTriage,
  diverReplyLanguage,
  draftReplyFor,
  draftReplyToMessage,
  replyFacts,
  translateReplyFor,
  triageInboundMessage,
} from "./store";

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
  it("describes an empty public departure window using the actual 45-day horizon", async () => {
    await ctx.db.update(trips).set({ isPrivate: true }).where(eq(trips.shopId, ctx.shop.id));
    const { window, lines } = await replyFacts(ctx.db, ctx.shop.id);
    expect(window).toContain("the next 45 days");
    expect(lines).toContain("- No public departures are listed in this 45-day window.");
    expect(lines.join("\n")).not.toContain("two weeks");
  });

  it("keeps structured trip meeting destinations out of public draft facts while retaining the public shop address", async () => {
    await ctx.db
      .update(shops)
      .set({ addressStreet: "40 Public Shop Road" })
      .where(eq(shops.id, ctx.shop.id));
    await ctx.db
      .update(trips)
      .set({
        meetingPointLabel: "Private departure gate",
        meetingPointAddress: "101 Restricted Pier",
      })
      .where(eq(trips.shopId, ctx.shop.id));
    const facts = (await replyFacts(ctx.db, ctx.shop.id)).lines.join("\n");
    expect(facts).toContain("Address: 40 Public Shop Road");
    expect(facts).not.toContain("Private departure gate");
    expect(facts).not.toContain("101 Restricted Pier");
  });

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
    expect(window).toContain("the next 45 days");
    expect(window).toContain("at most 40 departures");
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
    // The seed writes demo notes, so this starts from none.
    await setShopReplyNotes(ctx.db, ctx.shop.id, null);
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
      }),
      env: keyed,
    });
    expect(draft).toBe("Park behind the shop. The gate opens at 7:15.");
  });

  it("answers a health question with a kind reply", async () => {
    const { personId } = await diverWithMessage("I have asthma, can I dive?");
    expect(
      await draftReplyFor(ctx.db, {
        shopId: ctx.shop.id,
        personId,
        provider: answering({
          reply:
            "Thanks for telling us. A physician's sign-off may be needed; our staff will help.",
          medical: true,
        }),
        env: keyed,
      }),
    ).toContain("physician");
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

describe("draftReplyToMessage", () => {
  it.each(["matched", "unmatched"] as const)(
    "keeps structured meeting destinations out of a %s sender's provider context",
    async (kind) => {
      await ctx.db
        .update(trips)
        .set({
          meetingPointLabel: "Private departure gate",
          meetingPointAddress: "101 Restricted Pier",
        })
        .where(eq(trips.shopId, ctx.shop.id));
      let messageId: string;
      if (kind === "matched") {
        ({ messageId } = await diverWithMessage("Where do we meet?"));
      } else {
        const recorded = await recordInboundMessage(ctx.db, {
          shopId: ctx.shop.id,
          channel: "email",
          fromAddress: "unmatched@example.org",
          body: "Where do we meet?",
          receivedAt: nowDate(),
          senderAuthenticated: true,
          providerMessageId: "unmatched-private-location",
        });
        if (recorded.status !== "recorded") throw new Error("fixture message missing");
        messageId = recorded.id;
      }
      const provider = answering({
        reply: "Staff will confirm your arrival details.",
        medical: false,
      });
      expect(
        await draftReplyToMessage(ctx.db, { shopId: ctx.shop.id, messageId, env: keyed, provider }),
      ).toBe("Staff will confirm your arrival details.");
      expect(provider.requests).toHaveLength(1);
      const sent = JSON.stringify(provider.requests[0]);
      expect(sent).not.toContain("Private departure gate");
      expect(sent).not.toContain("101 Restricted Pier");
      expect((await stored(messageId))?.answeredAt).toBeNull();
    },
  );

  it("answers a non-booking question from the selected message", async () => {
    await setShopReplyNotes(ctx.db, ctx.shop.id, "Park behind the shop.");
    const { messageId } = await diverWithMessage("Where do I park?");
    const draft = await draftReplyToMessage(ctx.db, {
      shopId: ctx.shop.id,
      messageId,
      env: keyed,
      provider: answering({
        reply: "Park behind the shop.",
        medical: false,
        eligibility: false,
        confidence: 0.9,
      }),
    });
    expect(draft).toBe("Park behind the shop.");
  });
  it("hands staff the draft as written, a price the shop never listed included", async () => {
    const { messageId } = await diverWithMessage("How much is a dive?");
    expect(
      await draftReplyToMessage(ctx.db, {
        shopId: ctx.shop.id,
        messageId,
        env: keyed,
        provider: answering({ reply: "Usually around $95; staff will confirm.", medical: false }),
      }),
    ).toBe("Usually around $95; staff will confirm.");
  });
  it("tells the model about the shop: what to bring and rental gear", async () => {
    const { lines } = await replyFacts(ctx.db, ctx.shop.id);
    const text = lines.join("\n");
    expect(text).toContain("What to bring:");
    expect(text).toContain("Rental gear:");
  });
  it("does not send another shop’s message to the model", async () => {
    const { messageId } = await diverWithMessage("Where do I park?");
    expect(
      await draftReplyToMessage(ctx.db, {
        shopId: "00000000-0000-4000-8000-000000000001",
        messageId,
        env: keyed,
      }),
    ).toBeNull();
  });
  it("does not draft for deleted or untrusted mail", async () => {
    const { messageId } = await diverWithMessage("Where do I park?");
    await ctx.db
      .update(inboundMessages)
      .set({ senderAuthenticated: false })
      .where(eq(inboundMessages.id, messageId));
    expect(
      await draftReplyToMessage(ctx.db, { shopId: ctx.shop.id, messageId, env: keyed }),
    ).toBeNull();
    await ctx.db
      .update(inboundMessages)
      .set({ senderAuthenticated: true, deletedAt: nowDate() })
      .where(eq(inboundMessages.id, messageId));
    expect(
      await draftReplyToMessage(ctx.db, { shopId: ctx.shop.id, messageId, env: keyed }),
    ).toBeNull();
  });
});

describe("selected-message draft freshness", () => {
  it("discards a draft when the subject changes while the provider is answering", async () => {
    const { messageId } = await diverWithMessage("Where do I park?");
    const fixture = answering({
      reply: "A staff member will confirm.",
      medical: false,
      eligibility: false,
      confidence: 0.9,
    });
    const provider: ClaudeProvider = {
      createMessage: async (request) => {
        await ctx.db
          .update(inboundMessages)
          .set({ subject: "Corrected question" })
          .where(eq(inboundMessages.id, messageId));
        return fixture.createMessage(request);
      },
    };
    expect(
      await draftReplyToMessage(ctx.db, { shopId: ctx.shop.id, messageId, env: keyed, provider }),
    ).toBeNull();
    expect(fixture.requests).toHaveLength(1);
  });
});
