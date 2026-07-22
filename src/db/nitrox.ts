import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
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
    status: "verified";
    reviewNote?: string;
  },
) {
  const [certification] = await db
    .update(nitroxCertifications)
    .set({
      status: input.status,
      reviewNote: input.reviewNote?.trim() || null,
      reviewedAt: nowDate(),
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

/**
 * Soft-archive a nitrox card: the row is kept for safety history but drops out
 * of every read (ADR 20260719-crud-archive-semantics). Shop-scoped. Safe by
 * construction: the fill gate (`verifiedNitroxPersonIds`, `setBookingNitrox`)
 * and the manifest read the card live, so a booking that requested enriched air
 * fails closed the moment its backing card is archived.
 */
export async function archiveNitroxCertification(
  db: AppDb,
  input: { shopId: string; certificationId: string },
) {
  const [row] = await db
    .update(nitroxCertifications)
    .set({ deletedAt: nowDate() })
    .where(
      and(
        eq(nitroxCertifications.id, input.certificationId),
        eq(nitroxCertifications.shopId, input.shopId),
        isNull(nitroxCertifications.deletedAt),
      ),
    )
    .returning({ id: nitroxCertifications.id });
  return Boolean(row);
}

export async function listShopNitroxCertifications(db: AppDb, shopId: string) {
  return db
    .select({ certification: nitroxCertifications, person: people })
    .from(nitroxCertifications)
    .innerJoin(people, eq(people.id, nitroxCertifications.personId))
    .where(and(eq(nitroxCertifications.shopId, shopId), isNull(nitroxCertifications.deletedAt)))
    .orderBy(asc(people.fullName), asc(nitroxCertifications.createdAt));
}

/** The set of personIds with a verified nitrox card — the fill gate, in bulk. */
export async function verifiedNitroxPersonIds(db: AppDb, shopId: string): Promise<Set<string>> {
  const rows = await db
    .select({ personId: nitroxCertifications.personId })
    .from(nitroxCertifications)
    .where(
      and(
        eq(nitroxCertifications.shopId, shopId),
        eq(nitroxCertifications.status, "verified"),
        isNull(nitroxCertifications.deletedAt),
      ),
    );
  return new Set(rows.map((r) => r.personId));
}

export type SetBookingNitroxOutcome =
  | { ok: true; wantsNitrox: boolean; certified: boolean }
  | { ok: false; reason: "booking_unavailable" };

/**
 * Record whether a diver wants enriched air on one booking — billed per dive.
 *
 * A diver may *request* enriched air before their nitrox card is on file: the
 * request is recorded and `certified` reports whether a verified card backs it
 * right now, so the shop and diver are flagged rather than silently refused.
 * The request is NOT a fill authorization — the actual tank is gated live
 * downstream (the prep list, the manifest, and the Today queue all re-check the
 * verified card and fall back to air when it is missing), so an uncertified
 * request can never turn into a nitrox tank until a card is verified. Turning
 * the request *off* is always allowed.
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

    let certified = true;
    if (input.wantsNitrox) {
      const [card] = await tx
        .select({ id: nitroxCertifications.id })
        .from(nitroxCertifications)
        .where(
          and(
            eq(nitroxCertifications.shopId, input.shopId),
            eq(nitroxCertifications.personId, booking.personId),
            eq(nitroxCertifications.status, "verified"),
            isNull(nitroxCertifications.deletedAt),
          ),
        )
        .limit(1);
      certified = Boolean(card);
    }

    await tx
      .update(bookings)
      .set({ wantsNitrox: input.wantsNitrox })
      .where(eq(bookings.id, booking.id));
    return { ok: true, wantsNitrox: input.wantsNitrox, certified };
  });
}
