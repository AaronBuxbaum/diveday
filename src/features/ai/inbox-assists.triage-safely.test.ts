import { and, eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { recordInboundMessage } from "../../db/inbound-messages";
import { inboundMessages, shops } from "../../db/schema/index";
import { fileScopedShopContext } from "../../test/db";
import { fakeClaude, fakeClaudeMessage } from "../../test/fakes";
import { triageInboundMessagesSafely } from "./inbox-assists";

const ctx = fileScopedShopContext();

beforeEach(async () => {
  await ctx.db.update(shops).set({ isDemo: false }).where(eq(shops.id, ctx.shop.id));
});

async function message(body: string, providerMessageId: string) {
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
  return recorded.id;
}

it("keeps triaging the rest when one message fails", async () => {
  const first = await message("Gibt es Platz am Samstag?", "safely-1");
  const second = await message("Und am Sonntag?", "safely-2");
  const provider = fakeClaude({
    reply: () =>
      fakeClaudeMessage({
        text: JSON.stringify({
          intent: "question",
          urgent: false,
          language: "de",
          translation: "And on Sunday?",
          confidence: 0.9,
        }),
      }),
  });
  // The first query fails the way a dropped connection would; the later ones go through.
  let failed = false;
  const flaky = new Proxy(ctx.db, {
    get(target, prop, receiver) {
      if (prop === "select" && !failed) {
        failed = true;
        throw new Error("connection dropped");
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  await triageInboundMessagesSafely(flaky, ctx.shop.id, [first, second], {
    provider,
    env: { ANTHROPIC_API_KEY: "test-anthropic-key" },
  });
  expect(failed).toBe(true);
  const [row] = await ctx.db
    .select()
    .from(inboundMessages)
    .where(and(eq(inboundMessages.shopId, ctx.shop.id), eq(inboundMessages.id, second)));
  expect(row?.assistIntent).toBe("question");
});
