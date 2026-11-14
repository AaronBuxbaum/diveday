import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { draftReplyToMessage } from "@/features/inbox-assists";
import { replyFacts } from "@/features/inbox-assists/store";
import { REPLY_NOTES_MAX_LENGTH } from "@/lib/assists/inbox";
import { fileScopedShopContext } from "@/test/db";
import { fakeClaude, fakeClaudeMessage } from "@/test/fakes";
import { inboundMessages, shops } from "./schema";
import { resetDemoSchedule } from "./seed";
import { DEMO_SHOP_REPLY_NOTES } from "./seed-reply-notes";
import { DEMO_SHOP_DESK } from "./seed-shop-brand";

const ctx = fileScopedShopContext();

describe("demo inbox reply drafts", () => {
  it.each([false, true])(
    "keeps the complete desk handbook in seeded AI facts after reset=%s",
    async (reset) => {
      if (reset) await resetDemoSchedule(ctx.db, ctx.shop.id, "lean");
      const [shop] = await ctx.db.select().from(shops).where(eq(shops.id, ctx.shop.id));
      expect(shop.replyNotes).toBe(DEMO_SHOP_REPLY_NOTES);
      expect(DEMO_SHOP_DESK.replyNotes).toBe(DEMO_SHOP_REPLY_NOTES);
      expect(shop.replyNotes?.length).toBeGreaterThan(100);
      expect(shop.replyNotes?.length).toBeLessThanOrEqual(REPLY_NOTES_MAX_LENGTH);
      const { lines } = await replyFacts(ctx.db, ctx.shop.id);
      const notes = lines.slice(lines.indexOf("Notes from the shop:") + 1);
      expect(notes).toEqual(DEMO_SHOP_REPLY_NOTES.split("\n").filter(Boolean));
      expect(shop.replyNotes).toContain("The gate opens at 7:15.");
      expect(shop.replyNotes).not.toContain("$45");
    },
  );
  it.each([false, true])("lets seeded messages draft after reset=%s", async (reset) => {
    if (reset) await resetDemoSchedule(ctx.db, ctx.shop.id, "lean");
    const messages = await ctx.db
      .select()
      .from(inboundMessages)
      .where(eq(inboundMessages.shopId, ctx.shop.id));
    const seeded = messages.filter((message) =>
      message.providerMessageId?.startsWith("seed-inbox-"),
    );
    expect(seeded).toHaveLength(4);
    const reply = "Thanks for getting in touch. Our team will confirm the details with you.";
    const provider = fakeClaude({
      reply: (request) =>
        request.tools?.some((tool) => "name" in tool && tool.name === "read_shop_facts") &&
        request.messages.length === 1
          ? {
              ...fakeClaudeMessage({ text: "", stopReason: "tool_use" }),
              content: [
                {
                  type: "tool_use",
                  caller: { type: "direct" },
                  id: "facts",
                  name: "read_shop_facts",
                  input: {},
                },
              ],
            }
          : fakeClaudeMessage({
              text: JSON.stringify({ reply, medical: false, eligibility: false, confidence: 0.9 }),
            }),
    });
    for (const message of seeded) {
      expect(
        await draftReplyToMessage(ctx.db, {
          shopId: ctx.shop.id,
          messageId: message.id,
          provider,
          env: { ANTHROPIC_API_KEY: "test-anthropic-key" },
        }),
      ).toBe(reply);
    }
    expect(provider.requests).toHaveLength(8);
  });
});
