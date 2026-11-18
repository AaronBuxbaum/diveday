import { and, eq, isNull } from "drizzle-orm";
import { readActiveStaffRoles } from "@/db/authz";
import type { DbExecutor } from "@/db/client";
import { bookings, people, trips } from "@/db/schema";
import { livePerson, liveTrip } from "@/db/trips-live";
import { isStaff } from "@/lib/authz";

/**
 * Test-only read of current rows, not a durable snapshot or authorization.
 * Caller IDs are untrusted and the separately read roles can be stale before
 * this function returns. Nothing here issues a token, reserves a key, or
 * establishes the original meeting or booking after a move/reset.
 */
export async function observeRealContextForTest(
  db: DbExecutor,
  input: { shopId: string; tripId: string; bookingId: string; actorId: string },
) {
  const roles = await readActiveStaffRoles(db, input.shopId, input.actorId);
  if (!roles || !isStaff(roles)) return { kind: "unavailable" as const };
  const [row] = await db
    .select({ bookingId: bookings.id, tripId: trips.id, personId: people.id })
    .from(bookings)
    .innerJoin(
      trips,
      and(eq(trips.id, bookings.tripId), eq(trips.shopId, input.shopId), liveTrip()),
    )
    .innerJoin(
      people,
      and(
        eq(people.id, bookings.personId),
        eq(people.shopId, input.shopId),
        livePerson(),
        isNull(people.anonymizedAt),
      ),
    )
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        eq(bookings.id, input.bookingId),
        eq(trips.id, input.tripId),
      ),
    )
    .limit(1);
  if (!row) return { kind: "unavailable" as const };
  return {
    kind: "observed_only" as const,
    shopId: input.shopId,
    actorId: input.actorId,
    ...row,
    generation: "unknown" as const,
  };
}
