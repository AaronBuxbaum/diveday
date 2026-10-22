import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { ClaudeRequest } from "@/lib/claude/provider";
import { fileScopedShopContext } from "@/test/db";
import { fakeClaude, fakeClaudeMessage } from "@/test/fakes";
import { recordInboundMessage, recordStaffReply } from "./inbound-messages";
import {
  diverReplyLanguage,
  draftReplyFor,
  replyFacts,
  translateReplyFor,
  triageInboundMessage,
} from "./inbox-assists";
import { inboundMessages, people, personRoles, shops } from "./schema";
import { setShopFeature } from "./shops";

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
});

describe("replyFacts", () => {
  it("quotes the shop's departures with their open seats and prices from the database", async () => {
    const facts = await replyFacts(ctx.db, ctx.shop.id);
    expect(facts[0]).toContain(ctx.shop.name);
    expect(facts.some((line) => /seats open|full/.test(line))).toBe(true);
  });
});

describe("draftReplyFor", () => {
  it("drafts a reply that quotes only numbers the facts or the thread gave it", async () => {
    const { personId } = await diverWithMessage("Is there room for 2 on Saturday?");
    const facts = await replyFacts(ctx.db, ctx.shop.id);
    const quoted = facts.find((line) => line.includes("seats open")) ?? facts[0] ?? "";
    const draft = await draftReplyFor(ctx.db, {
      shopId: ctx.shop.id,
      personId,
      provider: answering({
        reply: `Yes! ${quoted.replace(/^- /, "")}`,
        medical: false,
        confidence: 0.9,
      }),
      env: keyed,
    });
    expect(draft).toContain(quoted.replace(/^- /, ""));
  });

  it("throws a draft away when it names a price nobody gave it", async () => {
    const { personId } = await diverWithMessage("How much is a dive?");
    expect(
      await draftReplyFor(ctx.db, {
        shopId: ctx.shop.id,
        personId,
        provider: answering({ reply: "It is 987654 dollars.", medical: false, confidence: 0.9 }),
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
        provider: answering({ reply: "Sure.", medical: true, confidence: 0.9 }),
        env: keyed,
      }),
    ).toBeNull();
  });

  it("drafts nothing when the shop wrote last, and sends no address", async () => {
    const { personId, messageId } = await diverWithMessage("Thanks!");
    const provider = answering({ reply: "You're welcome.", medical: false, confidence: 0.9 });
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
