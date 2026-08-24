import { and, eq, isNull } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { PreparedGearImport } from "@/lib/gear-import";
import type { AppDb } from "./client";
import { gearItems, gearServiceEvents, people, priorGearAssignments } from "./schema";

export async function commitGearImport(
  db: AppDb,
  shopId: string,
  prepared: PreparedGearImport,
  importedByPersonId: string,
) {
  return db.transaction(async (tx) => {
    let unitsCreated = 0;
    let unitsMatched = 0;
    let eventsAdded = 0;
    let eventsSkipped = 0;
    let assignmentsAdded = 0;
    let assignmentsSkipped = 0;
    let assignmentsUnmatched = 0;
    for (const row of prepared.rows) {
      const unitIssues = row.issues.filter((issue) => !issue.includes("assignment"));
      if (unitIssues.length > 0 || !row.label) continue;
      let [item] = await tx
        .select()
        .from(gearItems)
        .where(
          and(
            eq(gearItems.shopId, shopId),
            isNull(gearItems.deletedAt),
            eq(gearItems.label, row.label),
          ),
        )
        .limit(1);
      if (!item && row.serialNumber) {
        [item] = await tx
          .select()
          .from(gearItems)
          .where(
            and(
              eq(gearItems.shopId, shopId),
              isNull(gearItems.deletedAt),
              eq(gearItems.serialNumber, row.serialNumber),
            ),
          )
          .limit(1);
      }
      if (!item) {
        [item] = await tx
          .insert(gearItems)
          .values({
            shopId,
            kind: row.kind,
            label: row.label,
            size: row.size,
            serialNumber: row.serialNumber,
            brandModel: row.brandModel,
            purchasedOn: row.purchasedOn,
          })
          .returning();
        unitsCreated++;
      } else {
        unitsMatched++;
        [item] = await tx
          .update(gearItems)
          .set({
            kind: row.kind,
            size: row.size ?? item.size,
            serialNumber: row.serialNumber ?? item.serialNumber,
            brandModel: row.brandModel ?? item.brandModel,
            purchasedOn: row.purchasedOn ?? item.purchasedOn,
            updatedAt: nowDate(),
          })
          .where(and(eq(gearItems.id, item.id), isNull(gearItems.deletedAt)))
          .returning();
      }
      if (item && row.servicedOn && row.serviceKind) {
        const existing = await tx
          .select({ id: gearServiceEvents.id })
          .from(gearServiceEvents)
          .where(
            and(
              eq(gearServiceEvents.shopId, shopId),
              eq(gearServiceEvents.gearItemId, item.id),
              eq(gearServiceEvents.kind, row.serviceKind),
              eq(gearServiceEvents.servicedOn, row.servicedOn),
              row.nextDueOn
                ? eq(gearServiceEvents.nextDueOn, row.nextDueOn)
                : isNull(gearServiceEvents.nextDueOn),
              row.note ? eq(gearServiceEvents.note, row.note) : isNull(gearServiceEvents.note),
            ),
          )
          .limit(1);
        if (existing.length) eventsSkipped++;
        else {
          await tx.insert(gearServiceEvents).values({
            shopId,
            gearItemId: item.id,
            kind: row.serviceKind,
            servicedOn: row.servicedOn,
            nextDueOn: row.nextDueOn,
            nextDueDives: row.nextDueDives,
            note: row.note,
            recordedByPersonId: importedByPersonId,
          });
          eventsAdded++;
        }
      }
      if (item && (row.personEmail || row.personName || row.assignedFrom || row.assignedUntil)) {
        const person = row.personEmail
          ? (
              await tx
                .select({ id: people.id })
                .from(people)
                .where(and(eq(people.shopId, shopId), eq(people.email, row.personEmail)))
                .limit(1)
            )[0]
          : (
              await tx
                .select({ id: people.id })
                .from(people)
                .where(and(eq(people.shopId, shopId), eq(people.fullName, row.personName ?? "")))
                .limit(1)
            )[0];
        if (
          !person ||
          !row.assignedFrom ||
          !row.assignedUntil ||
          row.issues.some((issue) => issue.includes("assignment"))
        )
          assignmentsUnmatched++;
        else {
          const dedupeKey =
            row.assignmentReference ??
            [row.assignedFrom, row.assignedUntil, row.assignmentStatus, row.assignmentNote]
              .filter(Boolean)
              .join("|");
          const inserted = await tx
            .insert(priorGearAssignments)
            .values({
              shopId,
              personId: person.id,
              gearItemId: item.id,
              assignedFrom: row.assignedFrom,
              assignedUntil: row.assignedUntil,
              statusLabel: row.assignmentStatus,
              sourceReference: row.assignmentReference,
              note: row.assignmentNote,
              dedupeKey,
              importedAt: nowDate(),
            })
            .onConflictDoNothing()
            .returning({ id: priorGearAssignments.id });
          if (inserted.length) assignmentsAdded++;
          else assignmentsSkipped++;
        }
      }
    }
    return {
      unitsCreated,
      unitsMatched,
      eventsAdded,
      eventsSkipped,
      assignmentsAdded,
      assignmentsSkipped,
      assignmentsUnmatched,
      rowsSkipped: prepared.rows.filter(
        (row) => row.issues.some((issue) => !issue.includes("assignment")) || !row.label,
      ).length,
    };
  });
}
