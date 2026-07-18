import { and, asc, desc, eq, ne } from "drizzle-orm";
import {
  DEFAULT_MAX_PPO2_BAR,
  isValidNitroxMix,
  maxOperatingDepthMeters,
  ppO2BarToCentibar,
} from "@/lib/nitrox";
import type { AppDb } from "./client";
import { bookings, gearItems, nitroxCertifications, nitroxFills, people, trips } from "./schema";

export type NewNitroxCertification = {
  shopId: string;
  personId: string;
  agency: "padi" | "ssi" | "naui" | "sdi" | "tdi" | "other";
  identifier: string;
};

/** Captured pending; a separate explicit review makes it usable as a fill gate. */
export async function createNitroxCertification(db: AppDb, input: NewNitroxCertification) {
  const [person] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.id, input.personId), eq(people.shopId, input.shopId)))
    .limit(1);
  if (!person) return null;
  const [certification] = await db
    .insert(nitroxCertifications)
    .values({
      shopId: input.shopId,
      personId: input.personId,
      agency: input.agency,
      identifier: input.identifier.trim(),
    })
    .returning();
  return certification ?? null;
}

export async function reviewNitroxCertification(
  db: AppDb,
  input: {
    shopId: string;
    certificationId: string;
    status: "verified" | "rejected";
    reviewNote?: string;
  },
) {
  const [certification] = await db
    .update(nitroxCertifications)
    .set({
      status: input.status,
      reviewNote: input.reviewNote?.trim() || null,
      reviewedAt: new Date(),
    })
    .where(
      and(
        eq(nitroxCertifications.id, input.certificationId),
        eq(nitroxCertifications.shopId, input.shopId),
      ),
    )
    .returning();
  return certification ?? null;
}

export async function listShopNitroxCertifications(db: AppDb, shopId: string) {
  return db
    .select({ certification: nitroxCertifications, person: people })
    .from(nitroxCertifications)
    .innerJoin(people, eq(people.id, nitroxCertifications.personId))
    .where(eq(nitroxCertifications.shopId, shopId))
    .orderBy(asc(people.fullName), asc(nitroxCertifications.createdAt));
}

/** The set of personIds with a verified nitrox card — the fill gate, in bulk. */
export async function verifiedNitroxPersonIds(db: AppDb, shopId: string): Promise<Set<string>> {
  const rows = await db
    .select({ personId: nitroxCertifications.personId })
    .from(nitroxCertifications)
    .where(
      and(eq(nitroxCertifications.shopId, shopId), eq(nitroxCertifications.status, "verified")),
    );
  return new Set(rows.map((r) => r.personId));
}

/** Current, non-retired tanks a fill can be logged against. */
export async function listShopTanks(db: AppDb, shopId: string) {
  return db
    .select()
    .from(gearItems)
    .where(
      and(eq(gearItems.shopId, shopId), eq(gearItems.type, "tank"), ne(gearItems.state, "retired")),
    )
    .orderBy(asc(gearItems.label));
}

export type LogNitroxFillOutcome =
  | { ok: true; fillId: string; maxDepthMeters: number }
  | {
      ok: false;
      reason:
        | "booking_unavailable"
        | "staff_not_found"
        | "tank_not_found"
        | "not_a_tank"
        | "tank_retired"
        | "diver_not_certified"
        | "invalid_mix"
        | "analysis_required";
    };

/**
 * Record an enriched-air fill for a diver's tank. Fails closed at every gate:
 * the booking and tank must belong to the shop, the tank must be a usable
 * cylinder, the mix must be a valid recreational EANx blend, the diver must
 * hold a verified nitrox card, and the diver must have signed for their own
 * analysis. The MOD is derived here, never taken from the caller.
 */
export async function logNitroxFill(
  db: AppDb,
  input: {
    shopId: string;
    bookingId: string;
    gearItemId: string;
    oxygenPercent: number;
    analyzerSignature: string;
    filledByPersonId: string;
    maxPpO2Bar?: number;
  },
): Promise<LogNitroxFillOutcome> {
  const signature = input.analyzerSignature.trim();
  const maxPpO2Bar = input.maxPpO2Bar ?? DEFAULT_MAX_PPO2_BAR;
  return db.transaction(async (tx): Promise<LogNitroxFillOutcome> => {
    const [booking] = await tx
      .select({ id: bookings.id, personId: bookings.personId })
      .from(bookings)
      .where(
        and(
          eq(bookings.id, input.bookingId),
          eq(bookings.shopId, input.shopId),
          ne(bookings.status, "cancelled"),
        ),
      )
      .limit(1);
    if (!booking) return { ok: false, reason: "booking_unavailable" };

    const [staff] = await tx
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.id, input.filledByPersonId), eq(people.shopId, input.shopId)))
      .limit(1);
    if (!staff) return { ok: false, reason: "staff_not_found" };

    const [tank] = await tx
      .select({ id: gearItems.id, type: gearItems.type, state: gearItems.state })
      .from(gearItems)
      .where(and(eq(gearItems.id, input.gearItemId), eq(gearItems.shopId, input.shopId)))
      .limit(1);
    if (!tank) return { ok: false, reason: "tank_not_found" };
    if (tank.type !== "tank") return { ok: false, reason: "not_a_tank" };
    if (tank.state === "retired") return { ok: false, reason: "tank_retired" };

    // The safety gate: only a verified nitrox card earns an enriched-air fill.
    const [card] = await tx
      .select({ id: nitroxCertifications.id })
      .from(nitroxCertifications)
      .where(
        and(
          eq(nitroxCertifications.shopId, input.shopId),
          eq(nitroxCertifications.personId, booking.personId),
          eq(nitroxCertifications.status, "verified"),
        ),
      )
      .limit(1);
    if (!card) return { ok: false, reason: "diver_not_certified" };

    if (!isValidNitroxMix(input.oxygenPercent)) return { ok: false, reason: "invalid_mix" };
    if (!signature) return { ok: false, reason: "analysis_required" };

    const maxDepthMeters = maxOperatingDepthMeters(input.oxygenPercent, maxPpO2Bar);
    const [fill] = await tx
      .insert(nitroxFills)
      .values({
        shopId: input.shopId,
        bookingId: booking.id,
        gearItemId: tank.id,
        oxygenPercent: input.oxygenPercent,
        maxDepthMeters,
        maxPpO2Centibar: ppO2BarToCentibar(maxPpO2Bar),
        analyzerSignature: signature,
        filledByPersonId: staff.id,
      })
      .returning({ id: nitroxFills.id });
    if (!fill) throw new Error("logNitroxFill: insert returned no row");
    return { ok: true, fillId: fill.id, maxDepthMeters };
  });
}

/** Fills logged for one trip's divers, newest first, with diver, tank, and staff. */
export async function listTripNitroxFills(db: AppDb, shopId: string, tripId: string) {
  return db
    .select({
      fill: nitroxFills,
      person: people,
      tank: gearItems,
    })
    .from(nitroxFills)
    .innerJoin(bookings, eq(bookings.id, nitroxFills.bookingId))
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(gearItems, eq(gearItems.id, nitroxFills.gearItemId))
    .where(and(eq(nitroxFills.shopId, shopId), eq(bookings.tripId, tripId)))
    .orderBy(desc(nitroxFills.analyzedAt));
}

/** Recent fills across the whole shop for the nitrox overview. */
export async function listShopNitroxFills(db: AppDb, shopId: string, limit = 25) {
  return db
    .select({
      fill: nitroxFills,
      person: people,
      tank: gearItems,
      trip: trips,
    })
    .from(nitroxFills)
    .innerJoin(bookings, eq(bookings.id, nitroxFills.bookingId))
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(gearItems, eq(gearItems.id, nitroxFills.gearItemId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(eq(nitroxFills.shopId, shopId))
    .orderBy(desc(nitroxFills.analyzedAt))
    .limit(limit);
}
