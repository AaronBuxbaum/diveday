import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { departureNotes, people, reviewReplies } from "./schema";
import { seedShopVoice } from "./seed-shop-voice";

const ctx = fileScopedShopContext();

describe("the demo shop's own voice", () => {
  it("answers reviews and notes a departure, once however many times it runs", async () => {
    const { db, shop } = ctx;
    const [writer] = await db.select().from(people).where(eq(people.shopId, shop.id)).limit(1);
    if (!writer) throw new Error("no person");

    await seedShopVoice(db, shop.id, writer.id);
    await seedShopVoice(db, shop.id, writer.id);

    const replies = await db.select().from(reviewReplies).where(eq(reviewReplies.shopId, shop.id));
    const notes = await db.select().from(departureNotes).where(eq(departureNotes.shopId, shop.id));
    expect(replies.length).toBeLessThanOrEqual(2);
    expect(notes.length).toBeLessThanOrEqual(1);
    for (const reply of replies) expect(reply.body.length).toBeLessThanOrEqual(400);
  });
});
