import { and, eq, inArray, sql } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { boundLockWaits, isLockWaitRefusal } from "@/db/lock-bounds";
import { isTransactionExecutor } from "@/db/query-helpers";
import { boardingObservations } from "@/db/schema";

/**
 * Receipt prototype for disposable PostgreSQL tests only. Its table has no
 * migration and no serving caller. This does not authenticate a staff
 * member, verify a meeting token, drain old writers, or acknowledge a device.
 * Do not connect it to capture until those boundaries are implemented.
 */
export type DraftReceiptIntent = {
  shopId: string;
  clientKey: string;
  bookingId: string;
  tripId: string;
  observationId: string;
  /** Original event provenance, not the current recovery principal. */
  originalActorId: string;
  /** Untrusted device value, retained literally rather than treated as server time. */
  occurredAt: string | null;
  context:
    | { kind: "asserted"; generationId: string; meetingId: string }
    | { kind: "legacy_unknown" };
};

type DraftReceiptRow = {
  booking_id: string;
  trip_id: string;
  observation_id: string;
  original_actor_id: string;
  occurred_at_raw: string | null;
  context_kind: "asserted" | "legacy_unknown";
  generation_id: string | null;
  meeting_id: string | null;
};

export type DraftClaimResult =
  | { kind: "inserted" | "replayed"; observationId: string }
  | { kind: "key_reused" | "unverifiable" | "unavailable" };

class DraftTargetUnavailable extends Error {}

/**
 * Reserve a fully linked row under (shop, key), then verify and lock the
 * canonical open observation in the same root transaction. A result here is
 * a draft-table result only: no caller may treat it as a durable handoff.
 * Legacy unknown context is never acknowledged. A separate check of the old
 * observation-key index is not atomic against old writers, so this is not a
 * unified namespace and cannot be used for cutover.
 */
export async function claimDraftReceipt(
  db: AppDb,
  input: DraftReceiptIntent,
): Promise<DraftClaimResult> {
  if (isTransactionExecutor(db)) throw new Error("Draft receipt requires a root transaction");
  if (input.context.kind === "legacy_unknown") return { kind: "unverifiable" };
  if (!input.clientKey || input.clientKey.length < 8 || input.clientKey.length > 100) {
    return { kind: "unavailable" };
  }
  try {
    return await db.transaction(async (tx): Promise<DraftClaimResult> => {
      await boundLockWaits(tx);
      const isolation = await tx.execute(
        sql`select current_setting('transaction_isolation') as level`,
      );
      if ((isolation.rows[0] as { level?: string } | undefined)?.level !== "read committed") {
        return { kind: "unavailable" };
      }
      const generationId = input.context.kind === "asserted" ? input.context.generationId : null;
      const meetingId = input.context.kind === "asserted" ? input.context.meetingId : null;
      const [legacy] = await tx
        .select({
          id: boardingObservations.id,
          bookingId: boardingObservations.bookingId,
          tripId: boardingObservations.tripId,
        })
        .from(boardingObservations)
        .where(
          and(
            eq(boardingObservations.shopId, input.shopId),
            eq(boardingObservations.clientKey, input.clientKey),
          ),
        )
        .limit(1);
      if (legacy) {
        return legacy.id === input.observationId &&
          legacy.bookingId === input.bookingId &&
          legacy.tripId === input.tripId
          ? { kind: "unverifiable" }
          : { kind: "key_reused" };
      }
      const inserted = await tx.execute(sql`
        insert into draft_boarding_receipt_claims
          (shop_id, client_key, booking_id, trip_id, observation_id, original_actor_id,
           occurred_at_raw, context_kind, generation_id, meeting_id)
        values (${input.shopId}, ${input.clientKey}, ${input.bookingId}, ${input.tripId},
                ${input.observationId}, ${input.originalActorId}, ${input.occurredAt},
                ${input.context.kind}, ${generationId}, ${meetingId})
        on conflict (shop_id, client_key) do nothing returning observation_id
      `);
      if (inserted.rows.length === 0) {
        // A fresh READ COMMITTED statement sees the committed conflict winner.
        const existing = await tx.execute(sql`
          select booking_id, trip_id, observation_id, original_actor_id, occurred_at_raw,
                 context_kind, generation_id, meeting_id
          from draft_boarding_receipt_claims
          where shop_id = ${input.shopId} and client_key = ${input.clientKey}
        `);
        const row = existing.rows[0] as DraftReceiptRow | undefined;
        if (!row) throw new DraftTargetUnavailable();
        if (
          row.booking_id !== input.bookingId ||
          row.trip_id !== input.tripId ||
          row.observation_id !== input.observationId ||
          row.original_actor_id !== input.originalActorId ||
          row.occurred_at_raw !== input.occurredAt ||
          row.context_kind !== input.context.kind ||
          row.generation_id !== generationId ||
          row.meeting_id !== meetingId
        )
          return { kind: "key_reused" };
        if (row.context_kind === "legacy_unknown") return { kind: "unverifiable" };
        return { kind: "replayed", observationId: row.observation_id };
      }
      const [open] = await tx
        .select({ id: boardingObservations.id })
        .from(boardingObservations)
        .where(
          and(
            eq(boardingObservations.id, input.observationId),
            eq(boardingObservations.shopId, input.shopId),
            eq(boardingObservations.bookingId, input.bookingId),
            eq(boardingObservations.tripId, input.tripId),
            inArray(boardingObservations.state, ["pending", "conflict"]),
          ),
        )
        .for("update");
      if (!open) throw new DraftTargetUnavailable();
      return { kind: "inserted", observationId: open.id };
    });
  } catch (error) {
    if (error instanceof DraftTargetUnavailable || isLockWaitRefusal(error))
      return { kind: "unavailable" };
    throw error;
  }
}
