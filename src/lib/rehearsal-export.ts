import type { ExportTable } from "./export";

/**
 * **A rehearsal is not in the export** (ADR 20261012-rehearsal-departures).
 *
 * A training-day departure and its test seats are practice, not the shop's
 * record, so every bundle — the whole shop's and one diver's — leaves them out.
 * The bundle's reads stay as they are; this runs once over the finished tables,
 * so a file added later is covered by its columns rather than by someone
 * remembering to filter it:
 *
 * - `trips.csv` drops the rehearsal by `id`, `bookings.csv` its seats by `id`;
 * - every other file drops a row whose `trip_id` or `booking_id` names one.
 *
 * **One exception: a signed release.** A test diver may sign a real release at
 * the rehearsal (a staffer seating themselves, say), and that signature is
 * evidence that outlives the practice departure. Its row stays, with the
 * `booking_id` blanked so nothing in the bundle points at a seat that is not
 * in it — the same shape as a release issued from a diver's record, which
 * has no seat.
 */
export type RehearsalIds = {
  tripIds: ReadonlySet<string>;
  bookingIds: ReadonlySet<string>;
};

/** Files whose rows outlive the rehearsal: kept, with the seat reference blanked. */
const KEPT_WITH_SEAT_BLANKED = new Set(["waiver_records.csv"]);

export function withoutRehearsals(tables: ExportTable[], ids: RehearsalIds): ExportTable[] {
  if (ids.tripIds.size === 0 && ids.bookingIds.size === 0) return tables;
  return tables.map((table) => {
    const own =
      table.file === "trips.csv"
        ? ids.tripIds
        : table.file === "bookings.csv"
          ? ids.bookingIds
          : null;
    const idColumn = own ? table.header.indexOf("id") : -1;
    const tripColumn = table.header.indexOf("trip_id");
    const bookingColumn = table.header.indexOf("booking_id");
    const names = (column: number, set: ReadonlySet<string>, row: unknown[]) =>
      column >= 0 && typeof row[column] === "string" && set.has(row[column] as string);

    if (KEPT_WITH_SEAT_BLANKED.has(table.file)) {
      return {
        ...table,
        rows: table.rows.map((row) =>
          names(bookingColumn, ids.bookingIds, row)
            ? row.map((cell, index) => (index === bookingColumn ? null : cell))
            : row,
        ),
      };
    }
    return {
      ...table,
      rows: table.rows.filter(
        (row) =>
          !(own && names(idColumn, own, row)) &&
          !names(tripColumn, ids.tripIds, row) &&
          !names(bookingColumn, ids.bookingIds, row),
      ),
    };
  });
}
