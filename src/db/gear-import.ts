import { and, eq, isNull } from "drizzle-orm";
import { type AppDb } from "./client";
import { gearItems, gearServiceEvents } from "./schema";
import type { PreparedGearImport } from "@/lib/gear-import";

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
    for (const row of prepared.rows) {
      if (row.issues.length > 0 || !row.label) continue;
      let [item] = await tx
        .select()
        .from(gearItems)
        .where(and(eq(gearItems.shopId, shopId), isNull(gearItems.deletedAt), eq(gearItems.label, row.label)))
        .limit(1);
      if (!item && row.serialNumber) {
        [item] = await tx
          .select()
          .from(gearItems)
          .where(and(eq(gearItems.shopId, shopId), isNull(gearItems.deletedAt), eq(gearItems.serialNumber, row.serialNumber)))
          .limit(1);
      }
      if (!item) {
        [item] = await tx.insert(gearItems).values({ shopId, kind: row.kind, label: row.label, size: row.size, serialNumber: row.serialNumber, brandModel: row.brandModel, purchasedOn: row.purchasedOn }).returning();
        unitsCreated++;
      } else {
        unitsMatched++;
        [item] = await tx.update(gearItems).set({ kind: row.kind, size: row.size ?? item.size, serialNumber: row.serialNumber ?? item.serialNumber, brandModel: row.brandModel ?? item.brandModel, purchasedOn: row.purchasedOn ?? item.purchasedOn, updatedAt: new Date() }).where(and(eq(gearItems.id, item.id), isNull(gearItems.deletedAt))).returning();
      }
      if (!item || !row.servicedOn || !row.serviceKind) continue;
      const existing = await tx.select({ id: gearServiceEvents.id }).from(gearServiceEvents).where(and(eq(gearServiceEvents.shopId, shopId), eq(gearServiceEvents.gearItemId, item.id), eq(gearServiceEvents.kind, row.serviceKind), eq(gearServiceEvents.servicedOn, row.servicedOn), row.nextDueOn ? eq(gearServiceEvents.nextDueOn, row.nextDueOn) : isNull(gearServiceEvents.nextDueOn), row.note ? eq(gearServiceEvents.note, row.note) : isNull(gearServiceEvents.note))).limit(1);
      if (existing.length) { eventsSkipped++; continue; }
      await tx.insert(gearServiceEvents).values({ shopId, gearItemId: item.id, kind: row.serviceKind, servicedOn: row.servicedOn, nextDueOn: row.nextDueOn, nextDueDives: row.nextDueDives, note: row.note, recordedByPersonId: importedByPersonId });
      eventsAdded++;
    }
    return { unitsCreated, unitsMatched, eventsAdded, eventsSkipped, rowsSkipped: prepared.rows.filter((row) => row.issues.length > 0 || !row.label).length };
  });
}
