import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { DAY_MS } from "@/lib/clock";
import { levelCardLevel, specialtyCardSpecialty } from "./card-columns";
import type { DbExecutor } from "./client";
import { queryAll } from "./query-helpers";
import {
  type Card,
  type Certification,
  cards,
  people,
  type SpecialtyCertification,
  trips,
} from "./schema";
import { livePerson } from "./trips-live";

/**
 * **"Processed with PADI"** (fifth-loop ideas, item 46): whether the shop has
 * told the agency about a card it issued. It records the shop's own act and
 * issues nothing; the agency sends its own card. Every card the shop issues
 * can carry it: a level card, an Enriched Air card and a specialty card, each
 * a `cards` row of its kind, with the same two columns and the one
 * `cards_processed_only_when_issued` check (dive-domain review F4).
 */
export const CARD_KINDS = ["level", "nitrox", "specialty"] as const;

export type CardKind = (typeof CARD_KINDS)[number];

export function isCardKind(value: unknown): value is CardKind {
  return typeof value === "string" && (CARD_KINDS as readonly string[]).includes(value);
}

/** What the card certifies, as codes for its line on the list. */
export type CardWhat =
  | { kind: "level"; level: Certification["level"] }
  | { kind: "nitrox" }
  | { kind: "specialty"; specialty: SpecialtyCertification["specialty"] };

export type IssuedCard = {
  kind: CardKind;
  certificationId: string;
  agency: Card["agency"];
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
    const rows = await db
      .select({
        personId: cards.personId,
        certificationId: cards.id,
        agency: cards.agency,
        issuedAt: cards.issuedByShopAt,
        processedAt: cards.processedWithAgencyAt,
      })
      .from(cards)
      .where(
        and(
          eq(cards.shopId, shopId),
          eq(cards.kind, kind),
          eq(cards.issuedFromTripId, tripId),
          isNotNull(cards.issuedByShopAt),
          isNull(cards.deletedAt),
        ),
      )
      .orderBy(asc(cards.createdAt));
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
  const updated = await db
    .update(cards)
    .set(
      input.processed
        ? { processedWithAgencyAt: input.now, processedByPersonId: input.actorPersonId }
        : { processedWithAgencyAt: null, processedByPersonId: null },
    )
    .where(
      and(
        eq(cards.id, input.certificationId),
        eq(cards.shopId, input.shopId),
        // The id came from a form: it is not proof of which kind it names.
        eq(cards.kind, input.kind),
        isNotNull(cards.issuedByShopAt),
        isNull(cards.deletedAt),
        input.tripId ? eq(cards.issuedFromTripId, input.tripId) : undefined,
      ),
    )
    .returning({ id: cards.id });
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
function waitingOn(kind: CardKind, shopId: string) {
  return and(
    eq(cards.shopId, shopId),
    eq(cards.kind, kind),
    isNotNull(cards.issuedByShopAt),
    isNull(cards.processedWithAgencyAt),
    isNull(cards.deletedAt),
    livePerson(),
    isNull(people.anonymizedAt),
  );
}

const personJoin = (shopId: string) =>
  and(eq(people.id, cards.personId), eq(people.shopId, shopId));
const sessionJoin = (shopId: string) =>
  and(eq(trips.id, cards.issuedFromTripId), eq(trips.shopId, shopId));

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
          certificationId: cards.id,
          agency: cards.agency,
          issuedAt: cards.issuedByShopAt,
          level: levelCardLevel,
          personId: people.id,
          fullName: people.fullName,
          courseId: trips.courseId,
        })
        .from(cards)
        .innerJoin(people, personJoin(shopId))
        // diveday:allow-deleted-trips: a card earned on a session since deleted is still the diver's to submit.
        .leftJoin(trips, sessionJoin(shopId))
        .where(waitingOn("level", shopId)),
    () =>
      db
        .select({
          certificationId: cards.id,
          agency: cards.agency,
          issuedAt: cards.issuedByShopAt,
          personId: people.id,
          fullName: people.fullName,
          courseId: trips.courseId,
        })
        .from(cards)
        .innerJoin(people, personJoin(shopId))
        // diveday:allow-deleted-trips: a card earned on a session since deleted is still the diver's to submit.
        .leftJoin(trips, sessionJoin(shopId))
        .where(waitingOn("nitrox", shopId)),
    () =>
      db
        .select({
          certificationId: cards.id,
          agency: cards.agency,
          issuedAt: cards.issuedByShopAt,
          specialty: specialtyCardSpecialty,
          personId: people.id,
          fullName: people.fullName,
          courseId: trips.courseId,
        })
        .from(cards)
        .innerJoin(people, personJoin(shopId))
        // diveday:allow-deleted-trips: a card earned on a session since deleted is still the diver's to submit.
        .leftJoin(trips, sessionJoin(shopId))
        .where(waitingOn("specialty", shopId)),
  ]);
  const list: CardToProcess[] = [];
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
    list.push({
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
  return list.sort(
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

/**
 * The cut, read against the clock (visual triage of PR #2918, item 1d): the
 * migration instant once the clock has passed it, and none under a clock from
 * before it. Such a clock is a fixture's (the e2e fleet freezes Jul 21) whose
 * database already has the stamp, so every card's wait is known; a cut ahead
 * of the clock named a day nobody had reached ("certified before Fri, Oct 16").
 */
export function cardProcessingSince(now: Date): Date | null {
  return now.getTime() >= CARD_PROCESSING_SINCE.getTime() ? CARD_PROCESSING_SINCE : null;
}

/** Whether a card was issued before the cut {@link cardProcessingSince} reads at `now`. */
export function cardPredatesProcessing(issuedAt: Date, now: Date): boolean {
  const since = cardProcessingSince(now);
  return since !== null && issuedAt.getTime() < since.getTime();
}

/**
 * Whether a card has waited past {@link CARD_TO_PROCESS_LATE_DAYS}. A card
 * from before the stamp existed is never late: its wait is not known.
 */
export function cardIsLate(issuedAt: Date, now: Date): boolean {
  if (cardPredatesProcessing(issuedAt, now)) return false;
  return now.getTime() - issuedAt.getTime() > CARD_TO_PROCESS_LATE_DAYS * DAY_MS;
}

/** The list split at {@link cardProcessingSince}, each part still oldest first. */
export function splitCardsToProcess<T extends { issuedAt: Date }>(
  cards: readonly T[],
  now: Date,
): { current: T[]; earlier: T[] } {
  const current: T[] = [];
  const earlier: T[] = [];
  for (const card of cards) {
    (cardPredatesProcessing(card.issuedAt, now) ? earlier : current).push(card);
  }
  return { current, earlier };
}
