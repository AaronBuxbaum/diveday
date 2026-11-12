import type { AppDb } from "@/db/client";
import { recordShopActivity } from "@/db/shop-activity";
import type { getShopById } from "@/db/shops";
import { createTripOrRefusal } from "@/db/trips";
import { listBoats } from "@/features/boats";
import { getTripLens } from "@/features/trip-lenses";
import { type PatternDeparture, patternDives } from "@/features/weekday-pattern";
import { minorToMajor } from "@/lib/money";
import { MIN_TRIP_DAYS } from "@/lib/trip-days";
import { tripDetailsPatch } from "@/lib/trip-details";
import { assignCrewAfterCreate } from "./created-crew";

/**
 * The pattern's second departure on the same day. Its return time, when the
 * days disagreed, keeps this submission's — the desk can move it once it is on
 * the board, and a departure that is there is easier to fix than one that is
 * not. A shape the details reader refuses (a hull too small, an end before its
 * start) simply is not added; the first departure still lands.
 */
export async function addPatternDeparture(
  db: AppDb,
  shop: NonNullable<Awaited<ReturnType<typeof getShopById>>>,
  input: {
    also: PatternDeparture;
    date: string;
    fallback: {
      title: string;
      endTime: string;
      capacity: number;
      plannedDives: number;
      crewPersonIds: string[];
    };
    boats: Awaited<ReturnType<typeof listBoats>> | null;
    /** The staffer adding it, who is not told about their own crew choice. */
    actorPersonId: string;
    board: string;
  },
): Promise<boolean> {
  const { also, date, fallback } = input;
  const boatId = also.boatId ?? undefined;
  const boats = boatId ? (input.boats ?? (await listBoats(db, shop.id))) : null;
  const details = tripDetailsPatch(
    {
      date,
      startTime: also.startTime,
      endTime: also.endTime ?? fallback.endTime,
      dayCount: MIN_TRIP_DAYS,
      priceDollars:
        also.priceCents === null ? undefined : minorToMajor(also.priceCents, shop.currency),
      diveMode: (also.diveMode as "boat" | "shore" | "pool" | null) ?? undefined,
      boatId,
      capacity: also.capacity ?? fallback.capacity,
      boatCapacity: boatId ? (boats?.find((boat) => boat.id === boatId)?.capacity ?? null) : null,
      boatCertifiedPassengers: boatId
        ? (boats?.find((boat) => boat.id === boatId)?.certifiedPassengers ?? null)
        : null,
    },
    shop,
  );
  if (!details.ok) return false;
  if (also.lensId && !(await getTripLens(db, shop.id, also.lensId))) return false;
  // Issue #3915: the second departure refuses a hull in the yard as the first
  // does, in the write (#4009).
  const created = await createTripOrRefusal(db, {
    shopId: shop.id,
    title: also.title ?? fallback.title,
    capacity: also.capacity ?? fallback.capacity,
    plannedDives: Math.max(fallback.plannedDives, also.diveSiteIds?.length ?? 0),
    priceCents: details.patch.priceCents,
    depositCents: details.patch.depositCents,
    cancellationWindowHours: details.patch.cancellationWindowHours,
    minimumBookings: details.patch.minimumBookings,
    minimumDecisionHours: details.patch.minimumDecisionHours,
    diveMode: details.patch.diveMode,
    boatId: details.patch.boatId,
    lensId: also.lensId,
    dives: patternDives(also.diveSiteIds),
    startsAt: details.patch.startsAt,
    endsAt: details.patch.endsAt,
    scheduleDays: details.patch.scheduleDays,
  });
  if (!created || "refusal" in created) return false;
  await recordShopActivity(db, {
    shopId: shop.id,
    actorPersonId: input.actorPersonId,
    write: { code: "departure_added", tripId: created.id },
  });
  const crew = also.crewPersonIds.length > 0 ? also.crewPersonIds : fallback.crewPersonIds;
  if (crew.length > 0) {
    await assignCrewAfterCreate(db, shop.id, created.id, crew, input.actorPersonId, input.board);
  }
  return true;
}
