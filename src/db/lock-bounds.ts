import { sql } from "drizzle-orm";
import type { DbExecutor } from "./client";

/**
 * **How long a money or seat transaction waits for a row lock before it gives
 * up**: five seconds, then Postgres raises `55P03` (`lock_not_available`).
 *
 * Nothing bounded a lock wait before 2026-10-13 except the WhatsApp number claim
 * (`whatsapp-accounts.ts`), and the pool sets no default
 * (`src/lib/db-pool-config.ts`). So a staff tap queued behind a held seat waited
 * until its own function was killed, and the holder could be a transaction
 * waiting on Stripe (`createTipCheckout`). Failing in five seconds turns that
 * into an error the staffer sees and can retry (fourth review, row 17).
 *
 * `set local`, so the bound ends with the transaction and never leaks into a
 * pooled connection's next borrower. Called at the top of each lock helper
 * rather than once per role in a migration because whether the Neon pooler
 * honours a role-level setting has not been checked; this form works either way.
 * Outside a transaction `set local` does nothing (Postgres warns), which is the
 * right answer for a caller that holds no lock to bound.
 *
 * Five seconds is far above any healthy hold here (a seat transaction is
 * milliseconds) and below a function's own ceiling, so only a stuck holder is
 * refused. `lock-bounds.test.ts` pins that every money and seat lock helper
 * applies it; `seat-locks.postgres.test.ts` shows a waiter refused on a real
 * server, and `roll-call.postgres.test.ts` the crew roll call's trip lock
 * (#2983).
 */
export const LOCK_WAIT_BOUND = "5s";

export async function boundLockWaits(tx: DbExecutor): Promise<void> {
  await tx.execute(sql.raw(`set local lock_timeout = '${LOCK_WAIT_BOUND}'`));
}

/**
 * Whether `error` is that refusal: SQLSTATE `55P03`, on the error or anywhere
 * down its `cause` chain (drizzle wraps the driver's error in its own). An
 * action catches it to say "busy, tap again" in the reader's words instead of
 * a crash page; nothing retries it for them, for the reason `flushDeclarations`
 * gives about `40P01` in `bookings.ts`.
 */
export function isLockWaitRefusal(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    if (typeof current === "object" && (current as { code?: unknown }).code === "55P03") {
      return true;
    }
    current = typeof current === "object" ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}

/**
 * A `.catch` for an action's seat or booking call: the lock-wait refusal
 * becomes `"busy"` for the action to word, and anything else is rethrown.
 */
export function busyOnLockWait(error: unknown): "busy" {
  if (isLockWaitRefusal(error)) return "busy";
  throw error;
}
