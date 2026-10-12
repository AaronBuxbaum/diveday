import { eq, isNull } from "drizzle-orm";
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
 * arrive through a booking, a roll-call row or a manifest usually do not need
 * it, because `deleteTrip` refuses a departure that has any of those. **The
 * exception is a cleared rehearsal** (`clearFinishedRehearsals`): a deleted
 * trip that still has its cancelled seats, and may have a dockside roll call.
 * So a read that arrives through a child carries it anyway, wherever it costs
 * nothing: "this reader is safe by an invariant two modules away" has already
 * stopped being true once.
 *
 * **Which reads must not have it.** The series horizon roll's own bookkeeping
 * (`trip_series_skips` is what keeps a deleted occurrence deleted), the export
 * bundle where a shop is taking *everything* it has, and the staff view of
 * deleted departures itself.
 */
export const liveTrip = () => isNull(trips.deletedAt);

/**
 * **"This departure is a real one, not a rehearsal"** (ADR
 * 20261012-rehearsal-departures).
 *
 * Every read that faces outward — a public page or feed, a report, the
 * export, the availability answer, a message about to be sent, an integration
 * — carries this beside {@link liveTrip}. Staff operations reads do not: a
 * rehearsal is meant to be seated, checked in and rolled-called like the real
 * thing. `src/db/rehearsal-coverage.test.ts` walks the outward modules and
 * fails any read of `trips` in them that carries neither this nor a
 * `diveday:allow-rehearsal: <why>` comment.
 */
export const notRehearsal = () => eq(trips.isRehearsal, false);
