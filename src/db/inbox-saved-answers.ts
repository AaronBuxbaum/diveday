import { and, asc, count, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import {
  SAVED_ANSWER_BODY_MAX,
  SAVED_ANSWERS_MAX,
  savedAnswerTitle,
  withNameMarker,
} from "@/lib/saved-answers";
import type { DbExecutor } from "./client";
import { inboxSavedAnswers, people, staffReplies } from "./schema";

/**
 * **Saved answers** (fifth loop, item 15): the shop's own reply templates,
 * offered as chips above the reply box. Every read and write is scoped by the
 * shop id the caller's session carries; a posted id from another shop names
 * no row.
 */

export type SavedAnswer = { id: string; title: string; body: string };

/** The shop's live saved answers, oldest first, so a chip keeps its place. */
export async function listSavedAnswers(db: DbExecutor, shopId: string): Promise<SavedAnswer[]> {
  return db
    .select({ id: inboxSavedAnswers.id, title: inboxSavedAnswers.title, body: inboxSavedAnswers.body })
    .from(inboxSavedAnswers)
    .where(and(eq(inboxSavedAnswers.shopId, shopId), isNull(inboxSavedAnswers.deletedAt)))
    .orderBy(asc(inboxSavedAnswers.createdAt), asc(inboxSavedAnswers.id))
    .limit(SAVED_ANSWERS_MAX);
}

/** The ones deleted most recently, for "Put back". */
export async function listDeletedSavedAnswers(
  db: DbExecutor,
  shopId: string,
): Promise<SavedAnswer[]> {
  return db
    .select({ id: inboxSavedAnswers.id, title: inboxSavedAnswers.title, body: inboxSavedAnswers.body })
    .from(inboxSavedAnswers)
    .where(and(eq(inboxSavedAnswers.shopId, shopId), isNotNull(inboxSavedAnswers.deletedAt)))
    .orderBy(desc(inboxSavedAnswers.deletedAt))
    .limit(SAVED_ANSWERS_MAX);
}

async function liveCount(db: DbExecutor, shopId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(inboxSavedAnswers)
    .where(and(eq(inboxSavedAnswers.shopId, shopId), isNull(inboxSavedAnswers.deletedAt)));
  return row?.value ?? 0;
}

export type SaveAnswerOutcome =
  | { ok: true; id: string }
  | { ok: false; reason: "not_found" | "duplicate" | "full" };

/**
 * **"Save this answer"**, from a reply the shop already sent. Only the reply's
 * id is posted: the words are read from the stored reply inside the session's
 * shop, and the diver it went to has their name swapped for `{name}` before
 * anything is written, so the saved answer is about nobody.
 */
export async function saveAnswerFromReply(
  db: DbExecutor,
  input: { shopId: string; replyId: string },
): Promise<SaveAnswerOutcome> {
  const [reply] = await db
    .select({ body: staffReplies.body, fullName: people.fullName })
    .from(staffReplies)
    .innerJoin(people, eq(people.id, staffReplies.personId))
    .where(
      and(
        eq(staffReplies.id, input.replyId),
        eq(staffReplies.shopId, input.shopId),
        isNull(staffReplies.deletedAt),
      ),
    )
    .limit(1);
  if (!reply) return { ok: false, reason: "not_found" };
  const body = withNameMarker(reply.body, reply.fullName).trim().slice(0, SAVED_ANSWER_BODY_MAX);
  if (!body) return { ok: false, reason: "not_found" };

  return db.transaction(async (tx) => {
    const [same] = await tx
      .select({ id: inboxSavedAnswers.id })
      .from(inboxSavedAnswers)
      .where(
        and(
          eq(inboxSavedAnswers.shopId, input.shopId),
          eq(inboxSavedAnswers.body, body),
          isNull(inboxSavedAnswers.deletedAt),
        ),
      )
      .limit(1);
    if (same) return { ok: false, reason: "duplicate" } as const;
    if ((await liveCount(tx, input.shopId)) >= SAVED_ANSWERS_MAX) {
      return { ok: false, reason: "full" } as const;
    }
    const [row] = await tx
      .insert(inboxSavedAnswers)
      .values({ shopId: input.shopId, title: savedAnswerTitle(body), body })
      .returning({ id: inboxSavedAnswers.id });
    return row ? ({ ok: true, id: row.id } as const) : ({ ok: false, reason: "not_found" } as const);
  });
}

/** Delete, softly: the row stays, stamped, and "Put back" clears the stamp. */
export async function deleteSavedAnswer(
  db: DbExecutor,
  shopId: string,
  id: string,
): Promise<boolean> {
  const rows = await db
    .update(inboxSavedAnswers)
    .set({ deletedAt: nowDate() })
    .where(
      and(
        eq(inboxSavedAnswers.id, id),
        eq(inboxSavedAnswers.shopId, shopId),
        isNull(inboxSavedAnswers.deletedAt),
      ),
    )
    .returning({ id: inboxSavedAnswers.id });
  return rows.length > 0;
}

/** Put a deleted answer back, unless the row of chips is already full. */
export async function restoreSavedAnswer(
  db: DbExecutor,
  shopId: string,
  id: string,
): Promise<"restored" | "gone" | "full"> {
  return db.transaction(async (tx) => {
    if ((await liveCount(tx, shopId)) >= SAVED_ANSWERS_MAX) return "full" as const;
    const rows = await tx
      .update(inboxSavedAnswers)
      .set({ deletedAt: null })
      .where(
        and(
          eq(inboxSavedAnswers.id, id),
          eq(inboxSavedAnswers.shopId, shopId),
          isNotNull(inboxSavedAnswers.deletedAt),
        ),
      )
      .returning({ id: inboxSavedAnswers.id });
    return rows.length > 0 ? ("restored" as const) : ("gone" as const);
  });
}
