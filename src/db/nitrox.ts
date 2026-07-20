import { and, asc, eq, ne } from "drizzle-orm";
import type { AppDb } from "./client";
import { bookings, nitroxCertifications, people } from "./schema";

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

export type SetBookingNitroxOutcome =
  | { ok: true; wantsNitrox: boolean }
  | { ok: false; reason: "booking_unavailable" | "diver_not_certified" };

/**
 * Record whether a diver wants enriched air on one booking — billed per dive.
 *
 * The safety gate lives here: turning the request *on* requires a verified
 * nitrox card at write time, checked inside the transaction so a card being
 * reviewed concurrently can't slip a request through. Turning it *off* is
 * always allowed; refusing to clear a request would be the unsafe direction.
 */
export async function setBookingNitrox(
  db: AppDb,
  input: { shopId: string; bookingId: string; wantsNitrox: boolean },
): Promise<SetBookingNitroxOutcome> {
  return db.transaction(async (tx): Promise<SetBookingNitroxOutcome> => {
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

    if (input.wantsNitrox) {
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
    }

    await tx
      .update(bookings)
      .set({ wantsNitrox: input.wantsNitrox })
      .where(eq(bookings.id, booking.id));
    return { ok: true, wantsNitrox: input.wantsNitrox };
  });
}
