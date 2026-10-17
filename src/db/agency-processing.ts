import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { DAY_MS } from "@/lib/clock";
import type { DbExecutor } from "./client";
import { queryAll } from "./query-helpers";
import {
  certifications,
  nitroxCertifications,
  people,
  specialtyCertifications,
  trips,
} from "./schema";
import { livePerson } from "./trips-live";

/**
 * **"Processed with PADI"** (fifth-loop ideas, item 46): whether the shop has
 * told the agency about a card it issued. It records the shop's own act and
 * issues nothing; the agency sends its own card. Every card the shop issues
 * can carry it: a level card, an Enriched Air card and a specialty card, each
 * in its own table with the same two columns and the same
 * `*_processed_only_when_issued` check (dive-domain review F4).
 */
export const CARD_KINDS = ["level", "nitrox", "specialty"] as const;

export type CardKind = (typeof CARD_KINDS)[number];

export function isCardKind(value: unknown): value is CardKind {
  return typeof value === "string" && (CARD_KINDS as readonly string[]).includes(value);
}

type CardTable =
  | typeof certifications
  | typeof nitroxCertifications
  | typeof specialtyCertifications;

const CARD_TABLES: Record<CardKind, CardTable> = {
  level: certifications,
  nitrox: nitroxCertifications,
  specialty: specialtyCertifications,
};

/** What the card certifies, as codes for its line on the list. */
export type CardWhat =
  | { kind: "level"; level: (typeof certifications.$inferSelect)["level"] }
  | { kind: "nitrox" }
  | { kind: "specialty"; specialty: (typeof specialtyCertifications.$inferSelect)["specialty"] };

export type IssuedCard = {
  kind: CardKind;
  certificationId: string;
  agency: (typeof certifications.$inferSelect)["agency"];
  issuedAt: Date;
  processedAt: Date | null;
};

/**
 * The live cards this session issued, by the person who earned each. A
 * session issues its course's one kind of card, so one card per person; the
 * level card wins if a person somehow holds two.
 */
export async function issuedCardsForTrip(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<Map<string, IssuedCard>> {
  const byPerson = new Map<string, IssuedCard>();
  for (const kind of CARD_KINDS) {
    const table = CARD_TABLES[kind];
    const rows = await db
      .select({
        personId: table.personId,
        certificationId: table.id,
        agency: table.agency,
        issuedAt: table.issuedByShopAt,
        processedAt: table.processedWithAgencyAt,
      })
      .from(table)
      .where(
        and(
          eq(table.shopId, shopId),
          eq(table.issuedFromTripId, tripId),
          isNotNull(table.issuedByShopAt),
          isNull(table.deletedAt),
        ),
      )
      .orderBy(asc(table.createdAt));
    for (const row of rows) {
      if (!row.issuedAt || byPerson.has(row.personId)) continue;
      byPerson.set(row.personId, {
        kind,
        certificationId: row.certificationId,
        agency: row.agency,
        issuedAt: row.issuedAt,
        processedAt: row.processedAt,
      });
    }
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
    kind: CardKind;
    certificationId: string;
    actorPersonId: string;
    processed: boolean;
    now: Date;
    /** From a session's roster: only a card that session issued. */
    tripId?: string;
  },
): Promise<boolean> {
  const table = CARD_TABLES[input.kind];
  const updated = await db
    .update(table)
    .set(
      input.processed
        ? { processedWithAgencyAt: input.now, processedByPersonId: input.actorPersonId }
        : { processedWithAgencyAt: null, processedByPersonId: null },
    )
    .where(
      and(
        eq(table.id, input.certificationId),
        eq(table.shopId, input.shopId),
        isNotNull(table.issuedByShopAt),
        isNull(table.deletedAt),
        input.tripId ? eq(table.issuedFromTripId, input.tripId) : undefined,
      ),
    )
    .returning({ id: table.id });
  return updated.length > 0;
}

/** A card waiting longer than this is called out on the list, never dropped from it. */
export const CARD_TO_PROCESS_LATE_DAYS = 30;

export type CardToProcess = IssuedCard & {
  what: CardWhat;
  personId: string;
  fullName: string;
  courseId: string | null;
};

/** The person and session joins every list query shares, each naming the shop (security N7). */
function waitingOn(table: CardTable, shopId: string) {
  return and(
    eq(table.shopId, shopId),
    isNotNull(table.issuedByShopAt),
    isNull(table.processedWithAgencyAt),
    isNull(table.deletedAt),
    livePerson(),
    isNull(people.anonymizedAt),
  );
}

const personJoin = (table: CardTable, shopId: string) =>
  and(eq(people.id, table.personId), eq(people.shopId, shopId));
const sessionJoin = (table: CardTable, shopId: string) =>
  and(eq(trips.id, table.issuedFromTripId), eq(trips.shopId, shopId));

/**
 * Every card the shop issued and has not marked processed, of every kind and
 * however old, oldest first: the instructor's list of students still to submit
 * to their agency. There is no lookback: a card gets more urgent with age, so
 * an old one is called out (`CARD_TO_PROCESS_LATE_DAYS`), never dropped
 * (dive-domain review F5). A card from before the stamp existed is listed
 * too; the page shows those apart ({@link splitCardsToProcess}).
 */
export async function listCardsToProcess(db: DbExecutor, shopId: string): Promise<CardToProcess[]> {
  const [levelRows, nitroxRows, specialtyRows] = await queryAll(db, [
    () =>
      db
        .select({
          certificationId: certifications.id,
          agency: certifications.agency,
          issuedAt: certifications.issuedByShopAt,
          level: certifications.level,
          personId: people.id,
          fullName: people.fullName,
          courseId: trips.courseId,
        })
        .from(certifications)
        .innerJoin(people, personJoin(certifications, shopId))
        // diveday:allow-deleted-trips: a card earned on a session since deleted is still the diver's to submit.
        .leftJoin(trips, sessionJoin(certifications, shopId))
        .where(waitingOn(certifications, shopId)),
    () =>
      db
        .select({
          certificationId: nitroxCertifications.id,
          agency: nitroxCertifications.agency,
          issuedAt: nitroxCertifications.issuedByShopAt,
          personId: people.id,
          fullName: people.fullName,
          courseId: trips.courseId,
        })
        .from(nitroxCertifications)
        .innerJoin(people, personJoin(nitroxCertifications, shopId))
        // diveday:allow-deleted-trips: a card earned on a session since deleted is still the diver's to submit.
        .leftJoin(trips, sessionJoin(nitroxCertifications, shopId))
        .where(waitingOn(nitroxCertifications, shopId)),
    () =>
      db
        .select({
          certificationId: specialtyCertifications.id,
          agency: specialtyCertifications.agency,
          issuedAt: specialtyCertifications.issuedByShopAt,
          specialty: specialtyCertifications.specialty,
          personId: people.id,
          fullName: people.fullName,
          courseId: trips.courseId,
        })
        .from(specialtyCertifications)
        .innerJoin(people, personJoin(specialtyCertifications, shopId))
        // diveday:allow-deleted-trips: a card earned on a session since deleted is still the diver's to submit.
        .leftJoin(trips, sessionJoin(specialtyCertifications, shopId))
        .where(waitingOn(specialtyCertifications, shopId)),
  ]);
  const cards: CardToProcess[] = [];
  const add = (
    row: {
      certificationId: string;
      agency: IssuedCard["agency"];
      issuedAt: Date | null;
      personId: string;
      fullName: string;
      courseId: string | null;
    },
    kind: CardKind,
    what: CardWhat,
  ) => {
    if (!row.issuedAt) return;
    cards.push({
      kind,
      what,
      certificationId: row.certificationId,
      agency: row.agency,
      issuedAt: row.issuedAt,
      processedAt: null,
      personId: row.personId,
      fullName: row.fullName,
      courseId: row.courseId,
    });
  };
  for (const row of levelRows) add(row, "level", { kind: "level", level: row.level });
  for (const row of nitroxRows) add(row, "nitrox", { kind: "nitrox" });
  for (const row of specialtyRows) {
    add(row, "specialty", { kind: "specialty", specialty: row.specialty });
  }
  // Oldest first; a tie keeps the order stable by name, then id.
  return cards.sort(
    (a, b) =>
      a.issuedAt.getTime() - b.issuedAt.getTime() ||
      (a.fullName < b.fullName ? -1 : a.fullName > b.fullName ? 1 : 0) ||
      (a.certificationId < b.certificationId ? -1 : 1),
  );
}

/**
 * When the processed stamp began: the moment of the migration that added it
 * (`20261017180605_processed-cards-lunch-aboard-and-room-charge`). A card the
 * shop issued before it has no stamp only because there was nowhere to put
 * one, and most were sent to the agency long ago. Without a cut every one of
 * them would land on the list at once, all "Waiting over 30 days", and an
 * instructor facing hundreds of false late rows learns to ignore the list
 * (dive-domain second pass, X2). Nothing is backfilled, since that could hide
 * a card that really was never sent: they stay listed, in their own collapsed
 * line, and none is called late.
 */
export const CARD_PROCESSING_SINCE = new Date("2026-10-16T23:42:42Z");

/** Whether a card was issued before {@link CARD_PROCESSING_SINCE}. */
export function cardPredatesProcessing(issuedAt: Date): boolean {
  return issuedAt.getTime() < CARD_PROCESSING_SINCE.getTime();
}

/**
 * Whether a card has waited past {@link CARD_TO_PROCESS_LATE_DAYS}. A card
 * from before the stamp existed is never late: its wait is not known.
 */
export function cardIsLate(issuedAt: Date, now: Date): boolean {
  if (cardPredatesProcessing(issuedAt)) return false;
  return now.getTime() - issuedAt.getTime() > CARD_TO_PROCESS_LATE_DAYS * DAY_MS;
}

/** The list split at {@link CARD_PROCESSING_SINCE}, each part still oldest first. */
export function splitCardsToProcess<T extends { issuedAt: Date }>(
  cards: readonly T[],
): { current: T[]; earlier: T[] } {
  const current: T[] = [];
  const earlier: T[] = [];
  for (const card of cards) (cardPredatesProcessing(card.issuedAt) ? earlier : current).push(card);
  return { current, earlier };
}
