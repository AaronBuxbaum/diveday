import { and, asc, eq, gt, inArray, isNull, ne } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { AppDb } from "./client";
import { publishManifestEventsForPerson } from "./manifest-events";
import { bookings, cards, people, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **A card's Delete, serialized with the seats that read it** (issue #3839).
 *
 * Every seat-granting write (the sale, a staff move, an undone removal, an
 * undone "Not here") reads the diver's cards under the **trip lock**: the
 * course gate's level card, the trip's own prerequisite. A delete that took no
 * lock could commit between that read and the seat's own write, and the seat
 * would be granted on a card that was gone by the time it landed.
 *
 * So the delete takes the locks the readers hold, in the order everything else
 * takes them: the **person row** (`no key update`: the weakest lock that
 * excludes a merge or an erasure rewriting the person, and one a booking's
 * `key share` never waits on), then the **departures the diver holds a seat
 * on** (cancelled seats included, since an undone removal is exactly the seat
 * that comes back), in id order, `no key update` like the restore. A reader
 * that already holds a departure makes the delete wait; a delete that
 * committed first is seen by the reader's next read.
 *
 * Only departures that have not ended: an undo is for the seat just taken off,
 * and a boat that has come home takes nobody back.
 */
export async function softDeleteCard(
  db: AppDb,
  input: {
    kind: "level" | "specialty" | "nitrox";
    shopId: string;
    certificationId: string;
    deletedByPersonId: string;
  },
): Promise<boolean> {
  let personId: string | undefined;
  const deleted = await db.transaction(async (tx) => {
    const [card] = await tx
      .select({ personId: cards.personId })
      .from(cards)
      .where(
        and(
          eq(cards.kind, input.kind),
          eq(cards.id, input.certificationId),
          eq(cards.shopId, input.shopId),
          isNull(cards.deletedAt),
        ),
      )
      .limit(1);
    if (!card) return false;
    personId = card.personId;
    await tx
      .select({ id: people.id })
      .from(people)
      // diveday:allow-deleted-people: the card's own holder, locked before the card is touched; a removed record keeps its cards.
      .where(and(eq(people.id, card.personId), eq(people.shopId, input.shopId)))
      .for("no key update");
    const seats = tx
      .select({ tripId: bookings.tripId })
      .from(bookings)
      .where(and(eq(bookings.shopId, input.shopId), eq(bookings.personId, card.personId)));
    await tx
      .select({ id: trips.id })
      .from(trips)
      .where(
        and(
          eq(trips.shopId, input.shopId),
          inArray(trips.id, seats),
          gt(trips.endsAt, nowDate()),
          ne(trips.status, "cancelled"),
          liveTrip(),
        ),
      )
      .orderBy(asc(trips.id))
      .for("no key update");
    const [row] = await tx
      .update(cards)
      .set({
        deletedAt: nowDate(),
        deletedByPersonId: input.deletedByPersonId,
        // A staffer's own Delete, the one archive a card's Undo may take back (#3701).
        deletionKind: "staff",
      })
      .where(
        and(
          eq(cards.kind, input.kind),
          eq(cards.id, input.certificationId),
          eq(cards.shopId, input.shopId),
          isNull(cards.deletedAt),
        ),
      )
      .returning({ id: cards.id });
    return Boolean(row);
  });
  // A deleted card changes readiness on every departure the diver is on, so a
  // roll call cached on a crew device must re-read: a boat may not leave with a
  // deleted card still showing as a cleared diver (issue #3839). After the
  // commit, never inside it.
  if (deleted && personId) await publishManifestEventsForPerson(db, input.shopId, personId);
  return deleted;
}
