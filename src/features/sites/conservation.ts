import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { tripDetailsAreEditable } from "@/db/trip-editability";
import { liveTrip, notRehearsal } from "@/db/trips";
import { readActiveStaffRoles } from "../../db/authz";
import type { AppDb, DbExecutor } from "../../db/client";
import { shops, tripConservation, trips } from "../../db/schema/index";
import { isStaff } from "../../lib/authz";
import { nowDate } from "../../lib/clock";
import { type ConservationFact, conservationFactSchema } from "../../lib/conservation";

async function conservationDeparture(db: DbExecutor, shopId: string, tripId: string) {
  const [row] = await db
    .select({
      endsAt: trips.endsAt,
      status: trips.status,
      enabled: shops.conservationEnabled,
    })
    .from(trips)
    .innerJoin(shops, eq(shops.id, trips.shopId))
    // diveday:allow-rehearsal: staff may practise; the diver reader excludes rehearsal trips.
    .where(and(eq(trips.shopId, shopId), eq(trips.id, tripId), liveTrip()))
    .limit(1);
  return row ?? null;
}

async function conservationRows(db: DbExecutor, shopId: string, tripId: string) {
  return db
    .select()
    .from(tripConservation)
    .where(
      and(
        eq(tripConservation.shopId, shopId),
        eq(tripConservation.tripId, tripId),
        isNull(tripConservation.deletedAt),
      ),
    )
    .orderBy(
      asc(tripConservation.recordedAt),
      asc(tripConservation.kind),
      asc(tripConservation.location),
      asc(tripConservation.quantity),
      asc(tripConservation.id),
    );
}

/** Staff editor, hidden entirely when the shop switches this feature off. */
export async function getTripConservationPanel(
  db: AppDb,
  shopId: string,
  tripId: string,
  personId: string,
  now = nowDate(),
) {
  const roles = await readActiveStaffRoles(db, shopId, personId);
  if (!roles || !isStaff(roles)) return null;
  const trip = await conservationDeparture(db, shopId, tripId);
  if (!trip?.enabled || trip.status === "cancelled") return null;
  return {
    rows: await conservationRows(db, shopId, tripId),
    editable: !(await tripDetailsAreEditable(db, shopId, tripId, now)),
  };
}

/** Quantified shop-attributed facts only; no staff identity crosses a bearer link. */
export async function tripConservationFacts(
  db: DbExecutor,
  shopId: string,
  tripId: string,
  now = nowDate(),
): Promise<ConservationFact[]> {
  // Keep the public projection scoped to live non-rehearsal departures and
  // the current feature switch. Return timing is shared with definition edits.
  const rows = await db
    .select({
      id: tripConservation.id,
      kind: tripConservation.kind,
      quantity: tripConservation.quantity,
      location: tripConservation.location,
      note: tripConservation.note,
    })
    .from(tripConservation)
    .innerJoin(trips, eq(trips.id, tripConservation.tripId))
    .innerJoin(shops, eq(shops.id, trips.shopId))
    .where(
      and(
        eq(tripConservation.shopId, shopId),
        eq(tripConservation.tripId, tripId),
        isNull(tripConservation.deletedAt),
        eq(trips.shopId, shopId),
        liveTrip(),
        notRehearsal(),
        eq(trips.status, "scheduled"),
        eq(shops.conservationEnabled, true),
      ),
    )
    .orderBy(
      asc(tripConservation.recordedAt),
      asc(tripConservation.kind),
      asc(tripConservation.location),
      asc(tripConservation.quantity),
      asc(tripConservation.id),
    );
  if (rows.length === 0 || (await tripDetailsAreEditable(db, shopId, tripId, now))) return [];
  return rows.map(({ id, kind, quantity, location, note }) => ({
    id,
    kind,
    quantity,
    location,
    note,
  }));
}

export type ConservationResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "not_authorized" | "unavailable" | "not_returned" | "stale" };

/** Add, correct or soft-delete a fact; every mutation rechecks live roles and the switch. */
export async function recordTripConservation(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    personId: string;
    operation: "record" | "delete" | "restore";
    id?: string;
    revision?: number;
    fact?: unknown;
    now?: Date;
  },
): Promise<ConservationResult> {
  const parsed = input.operation === "record" ? conservationFactSchema.safeParse(input.fact) : null;
  if (parsed && !parsed.success) return { ok: false, reason: "invalid" };
  if (input.operation !== "record" && !input.id) return { ok: false, reason: "invalid" };
  const now = input.now ?? nowDate();
  return db.transaction(async (tx): Promise<ConservationResult> => {
    const roles = await readActiveStaffRoles(tx, input.shopId, input.personId);
    if (!roles || !isStaff(roles)) return { ok: false, reason: "not_authorized" };
    // Serialize against the feature toggle before taking the trip lock.
    const [shop] = await tx
      .select({ enabled: shops.conservationEnabled })
      .from(shops)
      .where(eq(shops.id, input.shopId))
      .for("share");
    if (!shop?.enabled) return { ok: false, reason: "unavailable" };
    const [trip] = await tx
      .select({ endsAt: trips.endsAt, status: trips.status })
      .from(trips)
      // diveday:allow-rehearsal: staff may practise recording without publishing the result.
      .where(and(eq(trips.shopId, input.shopId), eq(trips.id, input.tripId), liveTrip()))
      .for("update");
    if (!trip || trip.status === "cancelled") return { ok: false, reason: "unavailable" };
    if (await tripDetailsAreEditable(tx, input.shopId, input.tripId, now))
      return { ok: false, reason: "not_returned" };
    if (input.id) {
      const [changed] = await tx
        .update(tripConservation)
        .set(
          input.operation === "delete"
            ? { deletedAt: now, updatedAt: now, revision: (input.revision ?? 0) + 1 }
            : input.operation === "restore"
              ? { deletedAt: null, updatedAt: now, revision: (input.revision ?? 0) + 1 }
              : { ...parsed?.data, updatedAt: now, revision: (input.revision ?? 0) + 1 },
        )
        .where(
          and(
            eq(tripConservation.id, input.id),
            eq(tripConservation.shopId, input.shopId),
            eq(tripConservation.tripId, input.tripId),
            eq(tripConservation.revision, input.revision ?? 0),
            input.operation === "restore"
              ? isNotNull(tripConservation.deletedAt)
              : isNull(tripConservation.deletedAt),
          ),
        )
        .returning({ id: tripConservation.id });
      return changed ? { ok: true } : { ok: false, reason: "stale" };
    }
    if (!parsed?.success) return { ok: false, reason: "invalid" };
    await tx.insert(tripConservation).values({
      shopId: input.shopId,
      tripId: input.tripId,
      ...parsed.data,
      recordedByPersonId: input.personId,
      recordedAt: now,
      updatedAt: now,
    });
    return { ok: true };
  });
}
