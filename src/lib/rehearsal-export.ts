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
 * **The exception is evidence**: a signed release (a staffer seating
 * themselves may sign a real one), a course form, and the roll call. A
 * rehearsal where people were counted onto the boat or out of the water is a
 * record of people in the water, and it outlives the practice. Those rows stay,
 * with the `trip_id` and `booking_id` blanked so nothing in the bundle points
 * at a departure or seat that is not in it; the names and times stay, so the
 * row still says who and when.
 */
export type RehearsalIds = {
  tripIds: ReadonlySet<string>;
  bookingIds: ReadonlySet<string>;
};

/** Files whose rows outlive the rehearsal: kept, with its references blanked. */
const KEPT_AS_EVIDENCE = new Set([
  "waiver_records.csv",
  "course_form_records.csv",
  "roll_call_events.csv",
]);

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

    if (KEPT_AS_EVIDENCE.has(table.file)) {
      const blank = (row: unknown[], index: number) =>
        (index === bookingColumn && names(bookingColumn, ids.bookingIds, row)) ||
        (index === tripColumn && names(tripColumn, ids.tripIds, row));
      return {
        ...table,
        rows: table.rows.map((row) => row.map((cell, index) => (blank(row, index) ? null : cell))),
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
