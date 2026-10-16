import { and, asc, eq, gte, isNotNull, isNull } from "drizzle-orm";
import { DAY_MS } from "@/lib/clock";
import type { DbExecutor } from "./client";
import { certifications, people, trips } from "./schema";
import { livePerson } from "./trips-live";

/**
 * **"Processed with PADI"** (fifth-loop ideas, item 46): whether the shop has
 * told the agency about a card it issued. It records the shop's own act and
 * issues nothing; the agency sends its own card. Only a live level card the
 * shop issued can carry it (`certifications_processed_only_when_issued`).
 */
export type IssuedCard = {
  certificationId: string;
  agency: (typeof certifications.$inferSelect)["agency"];
  issuedAt: Date;
  processedAt: Date | null;
};

/** The live cards this session issued, by the person who earned each. */
export async function issuedCardsForTrip(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<Map<string, IssuedCard>> {
  const rows = await db
    .select({
      personId: certifications.personId,
      certificationId: certifications.id,
      agency: certifications.agency,
      issuedAt: certifications.issuedByShopAt,
      processedAt: certifications.processedWithAgencyAt,
    })
    .from(certifications)
    .where(
      and(
        eq(certifications.shopId, shopId),
        eq(certifications.issuedFromTripId, tripId),
        isNotNull(certifications.issuedByShopAt),
        isNull(certifications.deletedAt),
      ),
    )
    .orderBy(asc(certifications.createdAt));
  const byPerson = new Map<string, IssuedCard>();
  for (const row of rows) {
    if (!row.issuedAt) continue;
    byPerson.set(row.personId, {
      certificationId: row.certificationId,
      agency: row.agency,
      issuedAt: row.issuedAt,
      processedAt: row.processedAt,
    });
  }
  return byPerson;
}

/**
 * Tick a shop-issued card processed with its agency, or take the tick back.
 * Any staff member may; the stamp names who. False when the card is not this
 * shop's, not one it issued, or removed.
 */
export async function setCardProcessed(
  db: DbExecutor,
  input: {
    shopId: string;
    certificationId: string;
    actorPersonId: string;
    processed: boolean;
    now: Date;
    /** From a session's roster: only a card that session issued. */
    tripId?: string;
  },
): Promise<boolean> {
  const updated = await db
    .update(certifications)
    .set(
      input.processed
        ? { processedWithAgencyAt: input.now, processedByPersonId: input.actorPersonId }
        : { processedWithAgencyAt: null, processedByPersonId: null },
    )
    .where(
      and(
        eq(certifications.id, input.certificationId),
        eq(certifications.shopId, input.shopId),
        isNotNull(certifications.issuedByShopAt),
        isNull(certifications.deletedAt),
        input.tripId ? eq(certifications.issuedFromTripId, input.tripId) : undefined,
      ),
    )
    .returning({ id: certifications.id });
  return updated.length > 0;
}

/** How far back the course page's "cards to process" list reaches. */
export const CARDS_TO_PROCESS_LOOKBACK_DAYS = 90;

export type CardToProcess = IssuedCard & {
  personId: string;
  fullName: string;
  courseId: string | null;
};

/**
 * Cards the shop issued in the last {@link CARDS_TO_PROCESS_LOOKBACK_DAYS}
 * days and has not marked processed, oldest first: the instructor's list of
 * students still to submit to their agency.
 */
export async function listCardsToProcess(
  db: DbExecutor,
  shopId: string,
  now: Date,
): Promise<CardToProcess[]> {
  const since = new Date(now.getTime() - CARDS_TO_PROCESS_LOOKBACK_DAYS * DAY_MS);
  const rows = await db
    .select({
      certificationId: certifications.id,
      agency: certifications.agency,
      issuedAt: certifications.issuedByShopAt,
      personId: people.id,
      fullName: people.fullName,
      courseId: trips.courseId,
    })
    .from(certifications)
    .innerJoin(people, eq(people.id, certifications.personId))
    // diveday:allow-deleted-trips: a card earned on a session since deleted is still the diver's to submit.
    .leftJoin(trips, eq(trips.id, certifications.issuedFromTripId))
    .where(
      and(
        eq(certifications.shopId, shopId),
        isNotNull(certifications.issuedByShopAt),
        gte(certifications.issuedByShopAt, since),
        isNull(certifications.processedWithAgencyAt),
        isNull(certifications.deletedAt),
        livePerson(),
        isNull(people.anonymizedAt),
      ),
    )
    .orderBy(asc(certifications.issuedByShopAt), asc(people.fullName));
  return rows.flatMap((row) =>
    row.issuedAt ? [{ ...row, issuedAt: row.issuedAt, processedAt: null }] : [],
  );
}
