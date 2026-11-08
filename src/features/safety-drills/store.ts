import { and, asc, desc, eq, gte, inArray, isNull, lte, max } from "drizzle-orm";
import { canPersonViewShopReports } from "@/features/reporting";
import type { AppDb, DbExecutor } from "../../db/client";
import { people, safetyDrillParticipants, safetyDrills, shops } from "../../db/schema/index";
import { listStaff } from "../../db/trips";
import {
  calendarDateInTimezone,
  isValidCalendarDate,
  shiftCalendarDateMonths,
} from "../../lib/calendar-date";
import { nowDate } from "../../lib/clock";
import {
  DRILL_BACKDATE_MONTHS,
  DRILL_NOTE_MAX,
  type DrillKind,
  isDrillKind,
} from "../../lib/safety-drills";

/**
 * **The drill log's writer, its delete and its two readers** (loop 5, row 2;
 * `src/lib/safety-drills.ts`). The Safety tab's gate is the writer's gate: who
 * may read the record may add to it. Every read is the shop's own and live
 * (`deleted_at is null`).
 */

export type RecordSafetyDrillOutcome =
  | { ok: true; id: string }
  | {
      ok: false;
      reason: "not_allowed" | "invalid_kind" | "invalid_date" | "invalid_participant";
    };

export async function recordSafetyDrill(
  db: AppDb,
  input: {
    shopId: string;
    recordedByPersonId: string;
    kind: string;
    heldOn: string;
    note?: string | null;
    participantIds: readonly string[];
  },
): Promise<RecordSafetyDrillOutcome> {
  if (!(await canPersonViewShopReports(db, input.shopId, input.recordedByPersonId))) {
    return { ok: false, reason: "not_allowed" };
  }
  if (!isDrillKind(input.kind)) return { ok: false, reason: "invalid_kind" };
  const kind: DrillKind = input.kind;
  const [shop] = await db
    .select({ timezone: shops.timezone })
    .from(shops)
    .where(eq(shops.id, input.shopId))
    .limit(1);
  if (!shop) return { ok: false, reason: "not_allowed" };
  // A drill is something that happened: never a date the shop has not reached,
  // and never more than a year back (the sheet shows who logged it, and when).
  const today = calendarDateInTimezone(nowDate(), shop.timezone);
  const earliest = shiftCalendarDateMonths(today, -DRILL_BACKDATE_MONTHS);
  if (!isValidCalendarDate(input.heldOn) || input.heldOn > today || input.heldOn < earliest) {
    return { ok: false, reason: "invalid_date" };
  }
  const participantIds = [...new Set(input.participantIds)];
  const staffIds = new Set((await listStaff(db, input.shopId)).map((member) => member.person.id));
  if (participantIds.some((id) => !staffIds.has(id))) {
    return { ok: false, reason: "invalid_participant" };
  }
  const note = input.note?.trim().slice(0, DRILL_NOTE_MAX) || null;
  return db.transaction(async (tx) => {
    const [drill] = await tx
      .insert(safetyDrills)
      .values({
        shopId: input.shopId,
        kind,
        heldOn: input.heldOn,
        note,
        recordedByPersonId: input.recordedByPersonId,
      })
      .returning({ id: safetyDrills.id });
    if (!drill) throw new Error("safety drill insert returned no row");
    if (participantIds.length > 0) {
      await tx.insert(safetyDrillParticipants).values(
        participantIds.map((personId) => ({
          shopId: input.shopId,
          drillId: drill.id,
          personId,
        })),
      );
    }
    return { ok: true as const, id: drill.id };
  });
}

/** Stamps one drill deleted. False when it is not this shop's live drill or the person may not. */
export async function deleteSafetyDrill(
  db: AppDb,
  input: { shopId: string; personId: string; drillId: string },
): Promise<boolean> {
  if (!(await canPersonViewShopReports(db, input.shopId, input.personId))) return false;
  const stamped = await db
    .update(safetyDrills)
    .set({ deletedAt: nowDate(), deletedByPersonId: input.personId })
    .where(
      and(
        eq(safetyDrills.id, input.drillId),
        eq(safetyDrills.shopId, input.shopId),
        isNull(safetyDrills.deletedAt),
      ),
    )
    .returning({ id: safetyDrills.id });
  return stamped.length > 0;
}

export type SafetyDrillRow = {
  id: string;
  kind: DrillKind;
  heldOn: string;
  note: string | null;
  participants: string[];
  /** Who logged it, and when: the sheet shows both beside the date held. */
  recordedBy: string;
  recordedAt: Date;
};

/** The live drills held between two calendar dates, inclusive, newest first. */
export async function listSafetyDrills(
  db: DbExecutor,
  shopId: string,
  range: { from: string; to: string },
): Promise<SafetyDrillRow[]> {
  const drills = await db
    .select({
      id: safetyDrills.id,
      kind: safetyDrills.kind,
      heldOn: safetyDrills.heldOn,
      note: safetyDrills.note,
      recordedBy: people.fullName,
      recordedAt: safetyDrills.recordedAt,
    })
    .from(safetyDrills)
    .innerJoin(people, eq(people.id, safetyDrills.recordedByPersonId))
    .where(
      and(
        eq(safetyDrills.shopId, shopId),
        isNull(safetyDrills.deletedAt),
        gte(safetyDrills.heldOn, range.from),
        lte(safetyDrills.heldOn, range.to),
      ),
    )
    .orderBy(desc(safetyDrills.heldOn), desc(safetyDrills.recordedAt));
  if (drills.length === 0) return [];
  const names = await db
    .select({ drillId: safetyDrillParticipants.drillId, fullName: people.fullName })
    .from(safetyDrillParticipants)
    .innerJoin(people, eq(people.id, safetyDrillParticipants.personId))
    .where(
      and(
        eq(safetyDrillParticipants.shopId, shopId),
        inArray(
          safetyDrillParticipants.drillId,
          drills.map((drill) => drill.id),
        ),
      ),
    )
    .orderBy(asc(people.fullName));
  return drills.map((drill) => ({
    ...drill,
    participants: names.filter((row) => row.drillId === drill.id).map((row) => row.fullName),
  }));
}

/** The latest live drill of each kind the shop has ever held. */
export async function lastSafetyDrills(
  db: DbExecutor,
  shopId: string,
): Promise<Map<DrillKind, string>> {
  const rows = await db
    .select({ kind: safetyDrills.kind, heldOn: max(safetyDrills.heldOn) })
    .from(safetyDrills)
    .where(and(eq(safetyDrills.shopId, shopId), isNull(safetyDrills.deletedAt)))
    .groupBy(safetyDrills.kind);
  return new Map(
    rows.flatMap((row) => (row.heldOn ? [[row.kind, row.heldOn] as [DrillKind, string]] : [])),
  );
}
