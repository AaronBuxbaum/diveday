import { and, asc, eq, exists, isNull, or, sql } from "drizzle-orm";
import { isStaff } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import {
  PRE_DEPARTURE_CHECK_RETRACTION_SUPERSEDED,
  type PreDepartureCheckStatus,
} from "@/lib/pre-departure-check";
import { canPersonManageShopSettings, loadActiveStaffRoles } from "./authz";
import { type AppDb, type DbExecutor, violatesUniqueIndex } from "./client";
import { publishManifestEvent } from "./manifest-events";
import { people, preDepartureCheckEvents, preDepartureChecklistItems, trips } from "./schema";
import { liveTrip } from "./trips-live";

async function activeStaffRecorderId(
  tx: DbExecutor,
  shopId: string,
  personId: string,
): Promise<string | null> {
  const roles = await loadActiveStaffRoles(tx, shopId, personId);
  return roles && isStaff(roles) ? personId : null;
}

export type ChecklistItem = {
  id: string;
  label: string;
  sortOrder: number;
};

/** Every live item, in the shop's own reading order. */
export async function listChecklistItems(db: DbExecutor, shopId: string): Promise<ChecklistItem[]> {
  return db
    .select({
      id: preDepartureChecklistItems.id,
      label: preDepartureChecklistItems.label,
      sortOrder: preDepartureChecklistItems.sortOrder,
    })
    .from(preDepartureChecklistItems)
    .where(
      and(
        eq(preDepartureChecklistItems.shopId, shopId),
        isNull(preDepartureChecklistItems.deletedAt),
      ),
    )
    .orderBy(asc(preDepartureChecklistItems.sortOrder), asc(preDepartureChecklistItems.createdAt));
}

/**
 * Every item this trip should print on its departure log: every *live* item
 * (what the manifest offers today), plus any item this trip has an event
 * against even if the shop has since deleted it — found by a
 * dive-domain-expert review before merge. `listChecklistItems` alone made a
 * past incident document lose a line, and the check it recorded, the moment
 * a shop fixed a typo in that line's wording (delete-then-recreate is the
 * only edit path). The document's own footer promises "absence is stated,
 * never blank"; silently dropping a real `checked` event is the opposite of
 * that promise, on the one document built to hand to an insurer or an
 * investigator. `getIncidentExport` uses this, never `listChecklistItems`.
 */
export async function listChecklistItemsForTrip(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<ChecklistItem[]> {
  return db
    .select({
      id: preDepartureChecklistItems.id,
      label: preDepartureChecklistItems.label,
      sortOrder: preDepartureChecklistItems.sortOrder,
    })
    .from(preDepartureChecklistItems)
    .where(
      and(
        eq(preDepartureChecklistItems.shopId, shopId),
        or(
          isNull(preDepartureChecklistItems.deletedAt),
          exists(
            db
              .select({ one: sql`1` })
              .from(preDepartureCheckEvents)
              .where(
                and(
                  eq(preDepartureCheckEvents.checklistItemId, preDepartureChecklistItems.id),
                  eq(preDepartureCheckEvents.tripId, tripId),
                ),
              ),
          ),
        ),
      ),
    )
    .orderBy(asc(preDepartureChecklistItems.sortOrder), asc(preDepartureChecklistItems.createdAt));
}

export type CreateChecklistItemOutcome =
  | { ok: true; id: string }
  | { ok: false; reason: "not_authorized" | "duplicate_label" };

/**
 * Add one line to the shop's own list. `sortOrder` is set to one past the
 * current tail, so a new item reads last until the shop reorders it.
 */
export async function createChecklistItem(
  db: AppDb,
  input: { shopId: string; personId: string; label: string },
): Promise<CreateChecklistItemOutcome> {
  const label = input.label.trim();
  if (!(await canPersonManageShopSettings(db, input.shopId, input.personId))) {
    return { ok: false, reason: "not_authorized" };
  }
  try {
    return await db.transaction(async (tx) => {
      const [tail] = await tx
        .select({ sortOrder: preDepartureChecklistItems.sortOrder })
        .from(preDepartureChecklistItems)
        .where(
          and(
            eq(preDepartureChecklistItems.shopId, input.shopId),
            isNull(preDepartureChecklistItems.deletedAt),
          ),
        )
        .orderBy(sql`${preDepartureChecklistItems.sortOrder} desc`)
        .limit(1);
      const [row] = await tx
        .insert(preDepartureChecklistItems)
        .values({ shopId: input.shopId, label, sortOrder: (tail?.sortOrder ?? -1) + 1 })
        .returning({ id: preDepartureChecklistItems.id });
      if (!row) throw new Error("createChecklistItem: insert returned no row");
      return { ok: true, id: row.id };
    });
  } catch (error) {
    // The unique index is partial (live rows only), and Postgres's
    // ON CONFLICT arbiter only matches a partial index when the insert's own
    // WHERE clause repeats the index's predicate verbatim — so this catches
    // the 23505 instead, the same pattern `gear_reservations`' exclusion
    // constraint follows for the same reason (`violatesUniqueIndex`).
    if (violatesUniqueIndex(error, "pre_departure_checklist_items_shop_label_unique")) {
      return { ok: false, reason: "duplicate_label" };
    }
    throw error;
  }
}

/** The shop's own reordering, written whole — a short list, dragged in place. */
export async function reorderChecklistItems(
  db: AppDb,
  input: { shopId: string; personId: string; orderedIds: string[] },
): Promise<{ ok: true } | { ok: false; reason: "not_authorized" }> {
  if (!(await canPersonManageShopSettings(db, input.shopId, input.personId))) {
    return { ok: false, reason: "not_authorized" };
  }
  await db.transaction(async (tx) => {
    for (const [index, id] of input.orderedIds.entries()) {
      await tx
        .update(preDepartureChecklistItems)
        .set({ sortOrder: index, updatedAt: nowDate() })
        .where(
          and(
            eq(preDepartureChecklistItems.id, id),
            eq(preDepartureChecklistItems.shopId, input.shopId),
          ),
        );
    }
  });
  return { ok: true };
}

export async function deleteChecklistItem(
  db: AppDb,
  input: { shopId: string; personId: string; itemId: string },
): Promise<{ ok: true } | { ok: false; reason: "not_authorized" }> {
  if (!(await canPersonManageShopSettings(db, input.shopId, input.personId))) {
    return { ok: false, reason: "not_authorized" };
  }
  await db
    .update(preDepartureChecklistItems)
    .set({ deletedAt: nowDate(), deletedByPersonId: input.personId, updatedAt: nowDate() })
    .where(
      and(
        eq(preDepartureChecklistItems.id, input.itemId),
        eq(preDepartureChecklistItems.shopId, input.shopId),
      ),
    );
  return { ok: true };
}

export type PreDepartureCheckState = {
  checklistItemId: string;
  state: "checked";
  occurredAt: Date;
  recordedByName: string;
  note: string | null;
};

/**
 * The newest event per item on this trip — server truth for the manifest and
 * the departure log alike, exactly the role `listLatestRollCallByBooking`
 * plays for roll call. A `cleared` newest event collapses to no entry, the
 * same reduction `latestPreDepartureCheck` performs for a single item's
 * history.
 */
export async function latestPreDepartureChecksForTrip(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<Map<string, PreDepartureCheckState>> {
  const rows = await db
    .select({ event: preDepartureCheckEvents, recorder: people })
    .from(preDepartureCheckEvents)
    .innerJoin(people, eq(people.id, preDepartureCheckEvents.recordedByPersonId))
    .where(
      and(eq(preDepartureCheckEvents.shopId, shopId), eq(preDepartureCheckEvents.tripId, tripId)),
    )
    .orderBy(
      asc(preDepartureCheckEvents.occurredAt),
      asc(preDepartureCheckEvents.createdAt),
      asc(preDepartureCheckEvents.seq),
    );
  const latest = new Map<string, PreDepartureCheckState>();
  for (const { event, recorder } of rows) {
    if (event.status === "cleared") {
      latest.delete(event.checklistItemId);
      continue;
    }
    latest.set(event.checklistItemId, {
      checklistItemId: event.checklistItemId,
      state: "checked",
      occurredAt: event.occurredAt,
      recordedByName: recorder.fullName,
      note: event.note,
    });
  }
  return latest;
}

function offlineEventOutOfBounds(input: {
  clientEventId: string | undefined;
  offlineSnapshotSavedAt: Date | undefined;
  occurredAt: Date;
  now: Date;
}): boolean {
  const OFFLINE_EVENT_SKEW_MS = 5 * 60 * 1000;
  const savedAt = input.offlineSnapshotSavedAt;
  return (
    !input.clientEventId ||
    !savedAt ||
    savedAt.getTime() > input.occurredAt.getTime() + OFFLINE_EVENT_SKEW_MS ||
    input.occurredAt.getTime() > input.now.getTime() + OFFLINE_EVENT_SKEW_MS
  );
}

export type RecordPreDepartureCheckOutcome =
  | { ok: true; eventId: string; duplicate?: boolean }
  | {
      ok: false;
      reason:
        | "trip_unavailable"
        | "item_unavailable"
        | "staff_not_found"
        | "newer_event_exists"
        | typeof PRE_DEPARTURE_CHECK_RETRACTION_SUPERSEDED
        | "snapshot_invalid";
    };

/**
 * Record one tap against one checklist item — append-only, and never a gate on
 * anything else on this page (ADR 20260824-pre-departure-safety-check). The
 * `source === "offline"` branch mirrors `recordRollCall`'s, narrowed to what
 * this simpler subject needs: no checkpoint, no readiness gate, and no
 * "rescue an alarm from a rejection" asymmetry, because nothing recorded here
 * is the record of a diver who did not come back — see `pre-departure-check.ts`
 * for why that whole class of complexity does not apply.
 */
export async function recordPreDepartureCheck(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    checklistItemId: string;
    recordedByPersonId: string;
    status: PreDepartureCheckStatus;
    source?: "live" | "offline";
    clientEventId?: string;
    retractsClientEventId?: string;
    offlineSnapshotSavedAt?: Date;
    note?: string;
    occurredAt?: Date;
  },
): Promise<RecordPreDepartureCheckOutcome> {
  const outcome = await db.transaction(async (tx): Promise<RecordPreDepartureCheckOutcome> => {
    const source = input.source ?? "live";
    const occurredAt = input.occurredAt ?? nowDate();
    const staffId = await activeStaffRecorderId(tx, input.shopId, input.recordedByPersonId);
    if (!staffId) return { ok: false, reason: "staff_not_found" };

    if (source === "offline" && input.clientEventId) {
      const [existing] = await tx
        .select({ id: preDepartureCheckEvents.id })
        .from(preDepartureCheckEvents)
        .where(
          and(
            eq(preDepartureCheckEvents.shopId, input.shopId),
            eq(preDepartureCheckEvents.clientEventId, input.clientEventId),
          ),
        )
        .limit(1);
      if (existing) return { ok: true, eventId: existing.id, duplicate: true };
    }

    const [trip] = await tx
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
      .limit(1);
    if (!trip) return { ok: false, reason: "trip_unavailable" };

    const [item] = await tx
      .select({ id: preDepartureChecklistItems.id })
      .from(preDepartureChecklistItems)
      .where(
        and(
          eq(preDepartureChecklistItems.id, input.checklistItemId),
          eq(preDepartureChecklistItems.shopId, input.shopId),
          isNull(preDepartureChecklistItems.deletedAt),
        ),
      )
      .limit(1);
    if (!item) return { ok: false, reason: "item_unavailable" };

    if (source === "offline") {
      if (
        offlineEventOutOfBounds({
          clientEventId: input.clientEventId,
          offlineSnapshotSavedAt: input.offlineSnapshotSavedAt,
          occurredAt,
          now: nowDate(),
        })
      ) {
        return { ok: false, reason: "snapshot_invalid" };
      }
      const [newest] = await tx
        .select({
          occurredAt: preDepartureCheckEvents.occurredAt,
          clientEventId: preDepartureCheckEvents.clientEventId,
        })
        .from(preDepartureCheckEvents)
        .where(
          and(
            eq(preDepartureCheckEvents.shopId, input.shopId),
            eq(preDepartureCheckEvents.tripId, input.tripId),
            eq(preDepartureCheckEvents.checklistItemId, input.checklistItemId),
          ),
        )
        .orderBy(
          sql`${preDepartureCheckEvents.occurredAt} desc`,
          sql`${preDepartureCheckEvents.createdAt} desc`,
          sql`${preDepartureCheckEvents.seq} desc`,
        )
        .limit(1);
      if (newest && newest.occurredAt > occurredAt) {
        return { ok: false, reason: "newer_event_exists" };
      }
      if (
        input.status === "cleared" &&
        input.retractsClientEventId &&
        newest?.clientEventId?.toLowerCase() !== input.retractsClientEventId.toLowerCase()
      ) {
        return { ok: false, reason: PRE_DEPARTURE_CHECK_RETRACTION_SUPERSEDED };
      }
    }

    const [event] = await tx
      .insert(preDepartureCheckEvents)
      .values({
        shopId: input.shopId,
        tripId: input.tripId,
        checklistItemId: input.checklistItemId,
        recordedByPersonId: staffId,
        status: input.status,
        source,
        clientEventId: source === "offline" ? input.clientEventId : null,
        note: input.note?.trim() || null,
        occurredAt,
      })
      .returning({ id: preDepartureCheckEvents.id });
    if (!event) throw new Error("recordPreDepartureCheck: insert returned no row");
    return { ok: true, eventId: event.id };
  });
  if (outcome.ok && !outcome.duplicate) {
    await publishManifestEvent(db, input.shopId, input.tripId);
  }
  if (
    input.source === "offline" &&
    input.status === "cleared" &&
    !outcome.ok &&
    outcome.reason === PRE_DEPARTURE_CHECK_RETRACTION_SUPERSEDED
  ) {
    log("manifest.pre_departure_check_retraction_superseded", "warn", {
      shopId: input.shopId,
      tripId: input.tripId,
    });
  }
  return outcome;
}
