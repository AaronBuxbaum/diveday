import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { draftReplyToMessage } from "@/features/inbox-assists";
import { fileScopedShopContext } from "@/test/db";
import { fakeClaude, fakeClaudeMessage } from "@/test/fakes";
import { inboundMessages } from "./schema";
import { resetDemoSchedule } from "./seed";

const ctx = fileScopedShopContext();

describe("demo inbox reply drafts", () => {
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
      reply: () =>
        fakeClaudeMessage({
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
    expect(provider.requests).toHaveLength(4);
  });
});
