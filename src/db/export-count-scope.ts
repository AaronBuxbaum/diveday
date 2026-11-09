import { and, eq, getTableColumns, inArray, isNull, isTable, notInArray, or } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { rehearsalExportColumns } from "@/lib/rehearsal-export";
import type { DbExecutor } from "./client";
import { bookings, trips } from "./schema";

/** SQL counterpart of withoutRehearsals, driven by its same file/header policy. */
export function exportCountScope(
  db: DbExecutor,
  shopId: string,
  file: { file: string; header: readonly string[] },
  source: PgTable | Record<string, AnyPgColumn>,
) {
  const columns = isTable(source) ? getTableColumns(source as PgTable) : source;
  const byName = Object.fromEntries(Object.values(columns).map((column) => [column.name, column]));
  return and(
    ...rehearsalExportColumns(file.file, file.header).map(({ column: name, ids }) => {
      const column = byName[name];
      if (!column) throw new Error(`export count: ${file.file} has no SQL column for ${name}`);
      const rehearsalTrips = db
        .select({ id: trips.id })
        .from(trips)
        // diveday:allow-deleted-trips: historical rehearsals are excluded too, as in the bundle.
        .where(and(eq(trips.shopId, shopId), eq(trips.isRehearsal, true)));
      const excluded =
        ids === "tripIds"
          ? rehearsalTrips
          : db
              .select({ id: bookings.id })
              .from(bookings)
              .where(and(eq(bookings.shopId, shopId), inArray(bookings.tripId, rehearsalTrips)));
      return or(isNull(column), notInArray(column, excluded));
    }),
  );
}
