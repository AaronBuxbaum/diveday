import { and, eq, gt, sql } from "drizzle-orm";
import type { CallTranscript } from "@/lib/claude/transcript";
import { MINUTE_MS } from "@/lib/clock";
import { log } from "@/lib/log";
import type { AppDb, AppTransaction } from "./client";
import { claudeCallContent, claudeCallContentErasures } from "./schema";

/**
 * **What a Claude call said, kept 30 days, and forgotten on every erasure**
 * (ADR 20261023-claude-call-content). `runAssist` writes through
 * {@link keepClaudeCallContent}; every erasure path, with or without a person
 * record, goes through {@link forgetClaudeCallContent}.
 *
 * **An erasure that overlaps a call wins.** A caller reads a diver's words,
 * then asks Claude; a batch (the review queue's ten flags) may ask the last
 * one many minutes after it read them. If an erasure commits in between, the
 * shop's rows are already deleted when the answer comes back. So both sides
 * take one per-shop lock, the erasure stamps the shop's erasure time, and a
 * write whose words were read before that stamp, give or take
 * {@link ERASURE_OVERLAP_MS}, keeps nothing.
 */

/**
 * How far before an erasure's stamp a read still counts as overlapping it:
 * the stamp is taken inside the erasure's transaction, and a read can see the
 * pre-erasure words until that transaction commits. Longer than any erasure
 * runs; what it costs is a few minutes of debugging text after an erasure.
 */
export const ERASURE_OVERLAP_MS = 15 * MINUTE_MS;

type Executor = AppDb | AppTransaction;

async function lockShop(tx: Executor, shopId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('claude_call_content'), hashtext(${shopId}))`,
  );
}

/**
 * Deletes every content row for the shop and stamps the erasure, inside the
 * erasure's own transaction. A call still in flight either lands before this
 * (and is deleted) or sees the stamp and keeps nothing.
 */
export async function forgetClaudeCallContent(
  tx: AppTransaction,
  input: { shopId: string; now: Date },
): Promise<void> {
  await lockShop(tx, input.shopId);
  await tx.delete(claudeCallContent).where(eq(claudeCallContent.shopId, input.shopId));
  await tx
    .insert(claudeCallContentErasures)
    .values({ shopId: input.shopId, erasedAt: input.now })
    .onConflictDoUpdate({
      target: claudeCallContentErasures.shopId,
      set: { erasedAt: sql`greatest(${claudeCallContentErasures.erasedAt}, excluded.erased_at)` },
    });
}

export type KeepCallContentInput = {
  readonly usageId: string;
  readonly shopId: string;
  readonly feature: string;
  /** When the call was reserved: the row's `created_at`. */
  readonly now: Date;
  /** When the caller read what it sent; the call's start when it did not say. */
  readonly readAt: Date;
};

/**
 * Keeps what the call said. Never throws and never changes the answer: a row
 * that is skipped or cannot be written is a log line with a code.
 */
export async function keepClaudeCallContent(
  db: AppDb,
  input: KeepCallContentInput,
  transcript: CallTranscript,
): Promise<void> {
  try {
    // Its own transaction, a savepoint when the caller is already inside one,
    // so a failed insert can never abort the caller's work around it.
    const kept = await db.transaction(async (tx) => {
      await lockShop(tx, input.shopId);
      const readFrom = new Date(
        Math.min(input.readAt.getTime(), input.now.getTime()) - ERASURE_OVERLAP_MS,
      );
      const [erased] = await tx
        .select({ shopId: claudeCallContentErasures.shopId })
        .from(claudeCallContentErasures)
        .where(
          and(
            eq(claudeCallContentErasures.shopId, input.shopId),
            gt(claudeCallContentErasures.erasedAt, readFrom),
          ),
        )
        .limit(1);
      if (erased) return false;
      await tx.insert(claudeCallContent).values({
        usageId: input.usageId,
        shopId: input.shopId,
        systemText: transcript.system,
        contextText: transcript.context,
        contentText: transcript.content,
        answerText: transcript.answer,
        fetchedUrls: transcript.fetchedUrls,
        createdAt: input.now,
      });
      return true;
    });
    if (!kept) {
      log("claude_assist.content_not_kept", "info", {
        feature: input.feature,
        shopId: input.shopId,
        reason: "erasure",
      });
    }
  } catch {
    log("claude_assist.content_not_kept", "warn", {
      feature: input.feature,
      shopId: input.shopId,
      reason: "write_failed",
    });
  }
}
