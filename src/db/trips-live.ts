import { and, eq, isNull } from "drizzle-orm";
import { people, trips } from "./schema";

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
 * "This person is still on the shop's lists." The `liveTrip()` of `people`.
 *
 * Removing a diver sets `people.deleted_at` rather than deleting the row
 * (`deleteDiver`, src/db/divers.ts), and a staff member who also dives holds
 * the `diver` role, so a person can be removed while still holding a staff
 * role. A read that lists people a staffer acts on (the staff list behind
 * every crew picker), decides who may be put somewhere (crew eligibility), or
 * lets somebody in (sign-in) carries this predicate. `scripts/check-live-people.mjs`
 * holds the reads of `people` to it, with a baseline of the reads written
 * before it existed; most of those are by-id reads inside a transaction, or a
 * name looked up for an activity line, where a removed person is the right
 * answer.
 */
export const livePerson = () => isNull(people.deletedAt);

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

/**
 * The shop-owned, live, non-private trip scope shared by public reef reads.
 * Callers keep their own evidence-row filters, rehearsal and date/site filters;
 * this helper does not say whether a trip has sailed or is a rehearsal.
 */
export const livePublicTripForShop = (shopId: string) =>
  and(eq(trips.shopId, shopId), liveTrip(), eq(trips.isPrivate, false));
