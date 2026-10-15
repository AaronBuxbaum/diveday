import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { SAVED_ANSWERS_MAX } from "@/lib/saved-answers";
import { fileScopedShopContext } from "@/test/db";
import {
  deleteSavedAnswer,
  listDeletedSavedAnswers,
  listSavedAnswers,
  restoreSavedAnswer,
  saveAnswerFromReply,
} from "./inbox-saved-answers";
import { inboxSavedAnswers, people, shops, staffReplies } from "./schema";

const ctx = fileScopedShopContext();

/** A sent reply to a diver on file, in the seeded shop. */
async function seededDiver() {
  const { db, shop } = ctx;
  const [diver] = await db
    .select({ id: people.id, fullName: people.fullName })
    .from(staffReplies)
    .innerJoin(people, eq(people.id, staffReplies.personId))
    .where(eq(staffReplies.shopId, shop.id))
    .limit(1);
  if (!diver) throw new Error("the seeded inbox's answered diver is missing");
  return diver;
}

async function sentReply(body: string) {
  const { db, shop } = ctx;
  const diver = await seededDiver();
  const [reply] = await db
    .insert(staffReplies)
    .values({
      shopId: shop.id,
      personId: diver.id,
      channel: "email",
      toAddress: "lena@example.com",
      body,
      locale: "en-US",
      status: "sent",
      sentAt: new Date("2026-07-21T13:30:00.000Z"),
    })
    .returning({ id: staffReplies.id });
  return reply?.id as string;
}

describe("saveAnswerFromReply", () => {
  it("keeps the words, with the diver's name swapped for the marker", async () => {
    const first = (await seededDiver()).fullName.split(" ")[0] as string;
    const replyId = await sentReply(`Hi ${first}, park behind the shop by the tank racks.`);
    const outcome = await saveAnswerFromReply(ctx.db, { shopId: ctx.shop.id, replyId });
    expect(outcome.ok).toBe(true);
    const saved = (await listSavedAnswers(ctx.db, ctx.shop.id)).at(-1);
    expect(saved?.body).toBe("Hi {name}, park behind the shop by the tank racks.");
    expect(saved?.body).not.toContain(first);
    expect(saved?.title).toBe("Hi, park behind the shop by the tank…");
  });

  it("does not save the same answer twice", async () => {
    const first = await sentReply("We open the gate at 7:15.");
    const second = await sentReply("We open the gate at 7:15.");
    expect((await saveAnswerFromReply(ctx.db, { shopId: ctx.shop.id, replyId: first })).ok).toBe(
      true,
    );
    expect(
      await saveAnswerFromReply(ctx.db, { shopId: ctx.shop.id, replyId: second }),
    ).toMatchObject({
      ok: false,
      reason: "duplicate",
    });
  });

  it("refuses a reply from another shop as if it were not there", async () => {
    const replyId = await sentReply("Parking is behind the shop.");
    const [other] = await ctx.db
      .insert(shops)
      .values({ name: "Other Shop", slug: `other-${crypto.randomUUID()}`, timezone: "UTC" })
      .returning({ id: shops.id });
    expect(await saveAnswerFromReply(ctx.db, { shopId: other?.id as string, replyId })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("stops at a full row of chips", async () => {
    const live = (await listSavedAnswers(ctx.db, ctx.shop.id)).length;
    const rows = Array.from({ length: SAVED_ANSWERS_MAX - live }, (_, index) => ({
      shopId: ctx.shop.id,
      title: `Answer ${index}`,
      body: `Answer ${index}`,
    }));
    if (rows.length > 0) await ctx.db.insert(inboxSavedAnswers).values(rows);
    const replyId = await sentReply("One more answer.");
    expect(await saveAnswerFromReply(ctx.db, { shopId: ctx.shop.id, replyId })).toMatchObject({
      ok: false,
      reason: "full",
    });
  });
});

describe("deleting and putting back", () => {
  it("is soft, scoped to the shop, and reversible", async () => {
    const replyId = await sentReply("The shop opens at 7.");
    const outcome = await saveAnswerFromReply(ctx.db, { shopId: ctx.shop.id, replyId });
    if (!outcome.ok) throw new Error("expected a saved answer");

    expect(await deleteSavedAnswer(ctx.db, crypto.randomUUID(), outcome.id)).toBe(false);
    expect(await deleteSavedAnswer(ctx.db, ctx.shop.id, outcome.id)).toBe(true);
    expect((await listSavedAnswers(ctx.db, ctx.shop.id)).map((row) => row.id)).not.toContain(
      outcome.id,
    );
    expect((await listDeletedSavedAnswers(ctx.db, ctx.shop.id)).map((row) => row.id)).toContain(
      outcome.id,
    );
    const [kept] = await ctx.db
      .select()
      .from(inboxSavedAnswers)
      .where(eq(inboxSavedAnswers.id, outcome.id));
    expect(kept?.deletedAt).not.toBeNull();

    expect(await restoreSavedAnswer(ctx.db, ctx.shop.id, outcome.id)).toBe("restored");
    expect(await restoreSavedAnswer(ctx.db, ctx.shop.id, outcome.id)).toBe("gone");
    expect((await listSavedAnswers(ctx.db, ctx.shop.id)).map((row) => row.id)).toContain(
      outcome.id,
    );
  });
});
