import { and, eq, isNotNull, type SQL, sql } from "drizzle-orm";
import type { DbExecutor } from "@/db/client";
import { heldSendValues } from "@/db/held-send-rows";
import { notificationSendQueue } from "@/db/schema";
import type { HeldSendPayload } from "@/lib/held-sends";

/**
 * Held sends as a test reads them (issue #2730): the send-queue rows still
 * inside their hold, shaped like the `held_sends` row they used to be. A row
 * claimed, settled or undone is not here, which is what "the row is gone"
 * meant when the claim deleted it.
 */
export type HeldRow = {
  id: string;
  shopId: string;
  kind: string;
  payload: HeldSendPayload;
  actorPersonId: string | null;
  runAt: Date;
};

function heldWhere(match: { id?: string; shopId?: string; kind?: string }): SQL {
  return and(
    isNotNull(notificationSendQueue.intent),
    eq(notificationSendQueue.status, "queued"),
    match.id ? eq(notificationSendQueue.id, match.id) : undefined,
    match.shopId ? eq(notificationSendQueue.shopId, match.shopId) : undefined,
    match.kind ? sql`${notificationSendQueue.intent}->>'kind' = ${match.kind}` : undefined,
  ) as SQL;
}

export async function heldRows(
  db: DbExecutor,
  match: { id?: string; shopId?: string; kind?: string } = {},
): Promise<HeldRow[]> {
  const rows = await db.select().from(notificationSendQueue).where(heldWhere(match));
  return rows.map((row) => {
    const payload = row.intent as HeldSendPayload;
    return {
      id: row.id,
      shopId: row.shopId,
      kind: payload.kind,
      payload,
      actorPersonId: row.actorPersonId,
      runAt: row.nextAttemptAt,
    };
  });
}

export async function deleteHeldRows(
  db: DbExecutor,
  match: { id?: string; shopId?: string; kind?: string },
): Promise<void> {
  await db.delete(notificationSendQueue).where(heldWhere(match));
}

/**
 * Write a held row directly. `payload` is unchecked on purpose, so a test can
 * plant one this release cannot read (a retired kind).
 */
export async function insertHeldRow(
  db: DbExecutor,
  input: { shopId: string; payload: unknown; actorPersonId: string | null; runAt: Date },
): Promise<HeldRow> {
  const [row] = await db
    .insert(notificationSendQueue)
    .values(heldSendValues({ ...input, payload: input.payload as HeldSendPayload }))
    .returning();
  if (!row) throw new Error("held row was not written");
  const payload = row.intent as HeldSendPayload;
  return {
    id: row.id,
    shopId: row.shopId,
    kind: payload.kind,
    payload,
    actorPersonId: row.actorPersonId,
    runAt: row.nextAttemptAt,
  };
}
