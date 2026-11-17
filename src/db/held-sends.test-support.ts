import { and, eq, isNotNull } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { AppDb } from "./client";
import {
  claimRow,
  dueHeldIds,
  type HeldSendRow,
  settleHeldSend,
  settleInterruptedHeldSends,
  toRow,
} from "./held-sends";
import { notificationSendQueue } from "./schema";

/**
 * Test fixture: settle every
 * claim that lapsed as interrupted, then claim every held row whose hold has
 * drained. Each row is claimed by its own compare-and-swap, so a client
 * releasing the same row at the same moment sends it or this does, never both.
 */
export async function claimDueHeldSends(db: AppDb, now = nowDate()): Promise<HeldSendRow[]> {
  await settleInterruptedHeldSends(db, now);
  const claimed: HeldSendRow[] = [];
  for (const { id } of await dueHeldIds(db, now)) {
    const [row] = await claimRow(
      db,
      and(eq(notificationSendQueue.id, id), isNotNull(notificationSendQueue.intent)),
    );
    if (!row) continue;
    const readable = toRow(row);
    if (readable) claimed.push(readable);
    // A payload this release cannot read (one the release before it held) is
    // settled on its own and never costs the other due rows their send
    // (security review of #2656, minor 2).
    else await settleHeldSend(db, row.id, "failed", "held_intent_unreadable");
  }
  return claimed;
}
