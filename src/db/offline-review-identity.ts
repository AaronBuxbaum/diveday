import { and, eq, isNull } from "drizzle-orm";
import { lockBoardingCertificationEvidence } from "./boarding-certification-snapshot";
import type { AppDb, DbExecutor } from "./client";
import { bookings, people } from "./schema";

/** Must be called while the shop's shared erasure fence is held. */
async function liveReviewPerson(db: DbExecutor, shopId: string, personId: string) {
  const [person] = await db
    .select({ id: people.id, name: people.fullName })
    .from(people)
    .where(
      and(
        eq(people.shopId, shopId),
        eq(people.id, personId),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        isNull(people.mergedIntoPersonId),
      ),
    )
    .limit(1);
  return person;
}

/** Caller holds the shared erasure fence and the locked authoritative seat. */
export async function reviewPersonIsCurrent(
  db: DbExecutor,
  shopId: string,
  personId: string,
  identityUnconfirmedAt: Date | null,
  witnessedPersonId: string | undefined,
): Promise<boolean> {
  if (!witnessedPersonId || witnessedPersonId !== personId || identityUnconfirmedAt !== null)
    return false;
  return Boolean(await liveReviewPerson(db, shopId, personId));
}

/** Open a witnessed person and current assignment within one erasure-protected transaction. */
export async function readOfflineReviewIdentity(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    bookingId: string;
    personId: string;
    assignmentGeneration: number;
  },
): Promise<{ name: string | null; sameAssignment: boolean }> {
  return db.transaction(async (tx) => {
    await lockBoardingCertificationEvidence(tx, input.shopId, "boarding");
    const person = await liveReviewPerson(tx, input.shopId, input.personId);
    if (!person) return { name: null, sameAssignment: false };
    const [assignment] = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.shopId, input.shopId),
          eq(bookings.id, input.bookingId),
          eq(bookings.tripId, input.tripId),
          eq(bookings.personId, input.personId),
          eq(bookings.offlineAssignmentGeneration, input.assignmentGeneration),
          isNull(bookings.identityUnconfirmedAt),
        ),
      )
      .limit(1);
    return { name: person.name, sameAssignment: Boolean(assignment) };
  });
}
