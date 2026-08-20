import { isNull } from "drizzle-orm";
import { trips } from "./schema";

/**
 * "This departure is still on the board."
 *
 * Deleting a departure sets `trips.deleted_at` rather than removing the row
 * (ADR 20260820-every-delete-is-soft), so every read that means *the board*
 * carries this predicate. One exported condition rather than 90 hand-typed
 * `isNull(trips.deletedAt)` calls, for the reason the column exists: the
 * failure that matters is a reader somebody forgot, and a named import is
 * greppable in a way a spelled-out clause is not.
 *
 * **Which reads need it.** Anything that *lists* or *counts* departures, and
 * anything that resolves one by id for a surface a person acts on. Reads that
 * arrive through a booking, a roll-call row or a manifest do not strictly need
 * it — `deleteTrip` refuses a departure that has any of those, so a deleted row
 * has no children of that kind to arrive through — but they carry it anyway
 * where it costs nothing, because "this reader is safe by an invariant two
 * modules away" is exactly the reasoning that stops being true later.
 *
 * **Which reads must not have it.** The series horizon roll's own bookkeeping
 * (`trip_series_skips` is what keeps a deleted occurrence deleted), the export
 * bundle where a shop is taking *everything* it has, and the staff view of
 * deleted departures itself.
 */
export const liveTrip = () => isNull(trips.deletedAt);
