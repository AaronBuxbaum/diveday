import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { fakeClaude, fakeClaudeMessage } from "@/test/fakes";
import { bookingAskFromMessage, bookingAskFromNote } from "./booking-ask-assists";
import { recordInboundMessage } from "./inbound-messages";
import { people, personRoles, shops } from "./schema";

const ctx = fileScopedShopContext();

beforeEach(async () => {
  await ctx.db.update(shops).set({ isDemo: false }).where(eq(shops.id, ctx.shop.id));
});

const keyed = { ANTHROPIC_API_KEY: "test-anthropic-key" };
const now = new Date("2026-10-22T15:00:00.000Z");

function reading(value: Record<string, unknown>) {
  return fakeClaude({
    reply: () =>
      fakeClaudeMessage({
        text: JSON.stringify({
          fullName: null,
          email: null,
          phone: null,
          preferredDate: null,
          divers: null,
          interest: null,
          callback: null,
          confidence: 0.9,
          ...value,
        }),
      }),
  });
}

describe("bookingAskFromNote", () => {
  it("reads a scribble into the form's fields and links the diver the phone belongs to", async () => {
    await ctx.db.update(shops).set({ addressCountry: "US" }).where(eq(shops.id, ctx.shop.id));
    const [jen] = await ctx.db
      .insert(people)
      .values({ shopId: ctx.shop.id, fullName: "Jen Smith", phone: "+17865559871" })
      .returning({ id: people.id });
    if (!jen) throw new Error("fixture insert failed");
    await ctx.db.insert(personRoles).values({ personId: jen.id, role: "diver" });
    const provider = reading({
      fullName: "Jen Smith",
      phone: "786 555 9871",
      preferredDate: "2026-10-24",
      divers: 3,
      interest: "Saturday morning boat, nitrox",
      callback: "after 5",
    });
    const result = await bookingAskFromNote(ctx.db, {
      shopId: ctx.shop.id,
      text: "jen smith 3 ppl sat am wants nitrox call back after 5 786 555 9871",
      provider,
      env: keyed,
      now,
    });
    expect(result).toEqual({
      fields: {
        outcome: "date-request",
        fullName: "Jen Smith",
        phone: "786 555 9871",
        preferredDate: "2026-10-24",
        divers: "3",
        interest: "Saturday morning boat, nitrox",
      },
      callback: "after 5",
      match: { id: jen.id, name: "Jen Smith" },
    });
    expect(JSON.stringify(provider.requests[0])).toMatch(/<today>2026-10-22 \(Thursday\)<\/today>/);
  });

  it("is null while the shop's assists are dark, and never calls", async () => {
    await ctx.db
      .update(shops)
      .set({ claudeSuggestionsEnabled: false })
      .where(eq(shops.id, ctx.shop.id));
    const provider = reading({});
    expect(
      await bookingAskFromNote(ctx.db, {
        shopId: ctx.shop.id,
        text: "x",
        provider,
        env: keyed,
        now,
      }),
    ).toBeNull();
    expect(provider.requests).toHaveLength(0);
  });
});

describe("bookingAskFromMessage", () => {
  it("reads a booking email into a request, the reply address from the message itself", async () => {
    const recorded = await recordInboundMessage(ctx.db, {
      senderAuthenticated: true,
      shopId: ctx.shop.id,
      channel: "email",
      fromAddress: "group.lead@example.org",
      subject: "Saturday",
      body: "Four of us, Saturday morning, two Open Water, one Advanced, one never dived.",
      receivedAt: now,
      providerMessageId: "ask-1",
    });
    if (recorded.status !== "recorded") throw new Error("not recorded");
    const result = await bookingAskFromMessage(ctx.db, {
      shopId: ctx.shop.id,
      messageId: recorded.id,
      provider: reading({
        preferredDate: "2026-10-24",
        divers: 4,
        interest: "Saturday morning: 2 Open Water, 1 Advanced, 1 never dived",
      }),
      env: keyed,
      now,
    });
    expect(result?.fields).toEqual({
      outcome: "date-request",
      email: "group.lead@example.org",
      preferredDate: "2026-10-24",
      divers: "4",
      interest: "Saturday morning: 2 Open Water, 1 Advanced, 1 never dived",
    });
  });

  it("reads no other shop's message", async () => {
    const provider = reading({});
    expect(
      await bookingAskFromMessage(ctx.db, {
        shopId: ctx.shop.id,
        messageId: "00000000-0000-0000-0000-000000000000",
        provider,
        env: keyed,
        now,
      }),
    ).toBeNull();
    expect(provider.requests).toHaveLength(0);
  });
});
