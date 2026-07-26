import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { shopOffersNitrox } from "@/lib/rentals";
import { type AppDb, isUniqueConstraintViolation } from "./client";
import { type ReviewRefusal, reviewNoteFor } from "./readiness";
import { bookings, nitroxCertifications, people, shops } from "./schema";

export type NewNitroxCertification = {
  shopId: string;
  personId: string;
  agency: "padi" | "ssi" | "naui" | "sdi" | "tdi" | "other";
  identifier: string;
};

/**
 * Captured pending; a separate explicit review makes it usable as a fill gate.
 * Refuses (returns null) on a same-shop/agency/identifier collision in any
 * case, mirroring `createCertification` (CR-009).
 */
export async function createNitroxCertification(db: AppDb, input: NewNitroxCertification) {
  const [person] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.id, input.personId), eq(people.shopId, input.shopId)))
    .limit(1);
  if (!person) return null;
  try {
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
  } catch (error) {
    if (isUniqueConstraintViolation(error)) return null;
    throw error;
  }
}

/**
 * Confirming an **imported** nitrox card is what lets a fill give enriched air
 * (`authorizesNitroxFill` below), so — like the imported specialty confirm — it
 * requires the staffer to state that they have actually seen the card or checked
 * it with the agency (H-24). A card this shop captured itself is unaffected.
 */
export async function reviewNitroxCertification(
  db: AppDb,
  input: {
    shopId: string;
    certificationId: string;
    status: "verified";
    reviewNote?: string;
    cardSighted?: boolean;
  },
): Promise<
  | { ok: true; certification: typeof nitroxCertifications.$inferSelect }
  | { ok: false; reason: ReviewRefusal }
> {
  const [existing] = await db
    .select({ importedAt: nitroxCertifications.importedAt })
    .from(nitroxCertifications)
    .where(
      and(
        eq(nitroxCertifications.id, input.certificationId),
        eq(nitroxCertifications.shopId, input.shopId),
        isNull(nitroxCertifications.deletedAt),
      ),
    )
    .limit(1);
  if (!existing) return { ok: false, reason: "not_found" };
  if (existing.importedAt && !input.cardSighted) {
    return { ok: false, reason: "card_sighting_required" };
  }

  const [certification] = await db
    .update(nitroxCertifications)
    .set({
      status: input.status,
      reviewNote: reviewNoteFor(
        input.reviewNote,
        Boolean(existing.importedAt && input.cardSighted),
      ),
      reviewedAt: nowDate(),
    })
    .where(
      and(
        eq(nitroxCertifications.id, input.certificationId),
        eq(nitroxCertifications.shopId, input.shopId),
        // An archived card never comes back through a review — same rule the
        // specialty path applies, and this one authorizes a gas fill.
        isNull(nitroxCertifications.deletedAt),
      ),
    )
    .returning();
  return certification ? { ok: true, certification } : { ok: false, reason: "not_found" };
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

/**
 * Undo a nitrox-card soft-archive, mirroring `restoreCertification`. Refuses when
 * a live card already holds the same shop/agency/identifier (partial unique index).
 */
export async function restoreNitroxCertification(
  db: AppDb,
  input: { shopId: string; certificationId: string },
) {
  const [archived] = await db
    .select()
    .from(nitroxCertifications)
    .where(
      and(
        eq(nitroxCertifications.id, input.certificationId),
        eq(nitroxCertifications.shopId, input.shopId),
      ),
    )
    .limit(1);
  if (!archived || archived.deletedAt === null) return false;
  const [conflict] = await db
    .select({ id: nitroxCertifications.id })
    .from(nitroxCertifications)
    .where(
      and(
        eq(nitroxCertifications.shopId, input.shopId),
        eq(nitroxCertifications.agency, archived.agency),
        sql`lower(${nitroxCertifications.identifier}) = lower(${archived.identifier})`,
        isNull(nitroxCertifications.deletedAt),
      ),
    )
    .limit(1);
  if (conflict) return false;
  const [row] = await db
    .update(nitroxCertifications)
    .set({ deletedAt: null })
    .where(
      and(
        eq(nitroxCertifications.id, input.certificationId),
        eq(nitroxCertifications.shopId, input.shopId),
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

/**
 * A card authorizes an enriched-air fill when it is `verified`, live, and — if
 * it was brought in by the contact importer — a staffer has confirmed it here
 * (ADR 20260724-import-verified-cards). An imported nitrox card lands `verified`
 * so it can never be a boarding blocker, but the actual fill is the single
 * highest-consequence gate (wrong mix → oxygen toxicity), and a nitrox card
 * carries no expiry to catch a bad import later — so the fill specifically waits
 * for the one-tap confirm (`reviewedAt`) that clears `importedAt`. A card
 * entered by hand (no `importedAt`) is unaffected. `dive-domain-expert` review
 * carved this out; every fill-gate read must share this exact predicate.
 */
export const authorizesNitroxFill = and(
  eq(nitroxCertifications.status, "verified"),
  isNull(nitroxCertifications.deletedAt),
  sql`(${nitroxCertifications.importedAt} is null or ${nitroxCertifications.reviewedAt} is not null)`,
);

/** The set of personIds whose nitrox card authorizes a fill — the gate, in bulk. */
export async function verifiedNitroxPersonIds(db: AppDb, shopId: string): Promise<Set<string>> {
  const rows = await db
    .select({ personId: nitroxCertifications.personId })
    .from(nitroxCertifications)
    .where(and(eq(nitroxCertifications.shopId, shopId), authorizesNitroxFill));
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
 *
 * A request to turn it *on* is refused outright (silently downgraded to false,
 * same shape as any other clear) when the shop's rental catalog doesn't
 * include nitrox — most shops don't fill it at all, and the UI that would
 * offer this checkbox is hidden for them, so this is the write-time backstop
 * for a request that reaches here some other way (a stale form, a disabled
 * shop that never wiped its old capability link).
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

    let wantsNitrox = input.wantsNitrox;
    if (wantsNitrox) {
      const [shop] = await tx
        .select({ rentalItems: shops.rentalItems })
        .from(shops)
        .where(eq(shops.id, input.shopId))
        .limit(1);
      if (!shop || !shopOffersNitrox(shop.rentalItems)) wantsNitrox = false;
    }

    let certified = true;
    if (wantsNitrox) {
      const [card] = await tx
        .select({ id: nitroxCertifications.id })
        .from(nitroxCertifications)
        .where(
          and(
            eq(nitroxCertifications.shopId, input.shopId),
            eq(nitroxCertifications.personId, booking.personId),
            authorizesNitroxFill,
          ),
        )
        .limit(1);
      certified = Boolean(card);
    }

    await tx.update(bookings).set({ wantsNitrox }).where(eq(bookings.id, booking.id));
    return { ok: true, wantsNitrox, certified };
  });
}
