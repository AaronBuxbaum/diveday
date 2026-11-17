import { and, eq, isNull, ne } from "drizzle-orm";
import { verifyBookingCapability } from "@/db/booking-capabilities";
import type { DbExecutor } from "@/db/client";
import { bookings, people, trips } from "@/db/schema";
import { seatNotCancelled } from "@/db/trips";
import { privatePersonPhotoId } from "@/lib/person-photo";

/** A delivered readiness link can read only its live person's current private image. */
export async function getDiverPhotoState(
  db: DbExecutor,
  input: { token: string },
): Promise<{ hasPhoto: boolean; privatePhoto: { url: string; assetId: string } | null } | null> {
  const capability = await verifyBookingCapability(db, {
    token: input.token,
    purpose: "readiness",
  });
  if (!capability?.delivered) return null;
  const [row] = await db
    .select({
      url: people.diverPhotoPath,
      fallback: people.staffPhotoPath,
      suppressed: people.diverPhotoSuppressed,
    })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.id, capability.bookingId),
        eq(bookings.shopId, capability.shopId),
        eq(bookings.personId, capability.personId),
        eq(people.shopId, capability.shopId),
        eq(trips.shopId, capability.shopId),
        isNull(bookings.identityUnconfirmedAt),
        seatNotCancelled,
        ne(trips.status, "cancelled"),
        isNull(trips.deletedAt),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        isNull(people.mergedIntoPersonId),
      ),
    )
    .limit(1);
  if (!row) return null;
  // Close the gap between the capability read and the current-reference read.
  const latest = await verifyBookingCapability(db, { token: input.token, purpose: "readiness" });
  if (
    !latest?.delivered ||
    latest.bookingId !== capability.bookingId ||
    latest.personId !== capability.personId ||
    latest.shopId !== capability.shopId
  )
    return null;
  const assetId = row.url ? privatePersonPhotoId(row.url) : null;
  const privatePhoto = !row.suppressed && row.url && assetId ? { url: row.url, assetId } : null;
  return { hasPhoto: !row.suppressed && Boolean(privatePhoto || row.fallback), privatePhoto };
}

export async function getDiverPhotoForCapability(
  db: DbExecutor,
  input: { token: string; assetId: string },
): Promise<{ url: string; assetId: string } | null> {
  const state = await getDiverPhotoState(db, { token: input.token });
  return state?.privatePhoto?.assetId === input.assetId ? state.privatePhoto : null;
}
