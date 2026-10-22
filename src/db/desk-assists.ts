import { and, asc, eq, inArray, isNull, max, min, ne } from "drizzle-orm";
import type { SamePersonRecord } from "@/lib/assists/same-person";
import { matchRestsOnNameAlone } from "@/lib/diver-duplicates";
import type { AppDb } from "./client";
import { bookings, certifications, people, rentalFitProfiles, shops, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * The reads behind the desk assists (`gear-text`, `dupes`). Each reads only
 * what its prompt needs, in the session's shop, and nothing medical or from a
 * waiver: the gear note is the diver's own note to the crew about gear, and
 * the duplicate read takes names, contact fragments, birth dates, card levels
 * and visit months.
 */

/** The diver's gear note and the shop's catalog, or null without a note. */
export async function readGearNote(
  db: AppDb,
  shopId: string,
  personId: string,
): Promise<{ note: string; rentalItems: string[] } | null> {
  const [row] = await db
    .select({ note: rentalFitProfiles.note, rentalItems: shops.rentalItems })
    .from(rentalFitProfiles)
    .innerJoin(shops, eq(shops.id, rentalFitProfiles.shopId))
    .where(and(eq(rentalFitProfiles.shopId, shopId), eq(rentalFitProfiles.personId, personId)))
    .limit(1);
  const note = row?.note?.trim();
  if (!note) return null;
  return { note, rentalItems: (row?.rentalItems as string[] | null) ?? [] };
}

/** `YYYY-MM` of an instant, in UTC: a month is the grain the read needs. */
function month(at: Date | null): string | null {
  return at ? at.toISOString().slice(0, 7) : null;
}

/**
 * The two records of a pair, minimised for the same-person read, or null when
 * either is not a live diver of this shop, or when the pair is one the
 * duplicate check is sure about (an email or a phone agrees): the read is for
 * the pairs it is not sure about.
 */
export async function readUnsurePair(
  db: AppDb,
  shopId: string,
  sourceId: string,
  survivorId: string,
): Promise<[SamePersonRecord, SamePersonRecord] | null> {
  if (sourceId === survivorId) return null;
  const rows = await db
    .select({
      id: people.id,
      fullName: people.fullName,
      email: people.email,
      phone: people.phone,
      dateOfBirth: people.dateOfBirth,
    })
    .from(people)
    .where(
      and(
        eq(people.shopId, shopId),
        inArray(people.id, [sourceId, survivorId]),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        isNull(people.mergedIntoPersonId),
      ),
    );
  const source = rows.find((row) => row.id === sourceId);
  const survivor = rows.find((row) => row.id === survivorId);
  if (!source || !survivor || !matchRestsOnNameAlone(source, survivor)) return null;

  const cards = await db
    .select({ personId: certifications.personId, level: certifications.level })
    .from(certifications)
    .where(
      and(
        eq(certifications.shopId, shopId),
        inArray(certifications.personId, [sourceId, survivorId]),
      ),
    )
    .orderBy(asc(certifications.level));
  const visits = await db
    .select({ personId: bookings.personId, first: min(trips.startsAt), last: max(trips.startsAt) })
    .from(bookings)
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, bookings.shopId)))
    .where(
      and(
        eq(bookings.shopId, shopId),
        inArray(bookings.personId, [sourceId, survivorId]),
        ne(bookings.status, "cancelled"),
        liveTrip(),
      ),
    )
    .groupBy(bookings.personId);

  const record = (person: typeof source): SamePersonRecord => {
    const seen = visits.find((visit) => visit.personId === person.id);
    return {
      fullName: person.fullName,
      email: person.email,
      phone: person.phone,
      dateOfBirth: person.dateOfBirth,
      certifications: [
        ...new Set(cards.filter((card) => card.personId === person.id).map((card) => card.level)),
      ],
      firstSeen: month(seen?.first ?? null),
      lastSeen: month(seen?.last ?? null),
    };
  };
  return [record(source), record(survivor)];
}
