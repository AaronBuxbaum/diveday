import { sql } from "drizzle-orm";
import { errorCodeToken } from "@/lib/error-token";
import type { AppTransaction, DbExecutor } from "./client";

/**
 * Keep clearing retired answers until the next release removes their table.
 * A lock taken inside a savepoint proves the exact table exists and keeps it
 * from being dropped before the delete. Only a missing table is optional;
 * failed deletes and every other database error still abort the outer work.
 */
export async function withRetiredSavedAnswers(
  db: DbExecutor,
  clear: (tx: AppTransaction) => Promise<unknown>,
): Promise<void> {
  await db.transaction(async (tx) => {
    try {
      await tx.transaction(async (savepoint) => {
        await savepoint.execute(sql`lock table inbox_saved_answers in row exclusive mode`);
      });
    } catch (error) {
      if (errorCodeToken(error) === "42P01") return;
      throw error;
    }
    await clear(tx);
  });
}
