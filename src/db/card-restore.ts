import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { type CardUndoRefusal, cardUndoCutoff, cardUndoRefusal } from "@/lib/card-undo";
import { nowDate } from "@/lib/clock";
import { isUuid } from "@/lib/uuid";
import type { AppDb } from "./client";
import { isUniqueConstraintViolation } from "./query-helpers";
import { activityEvents, cards, people } from "./schema";
import { livePerson } from "./trips-live";

/** What a card's Undo did. Codes, never sentences. */
export type CardRestoreOutcome =
  | "restored"
  /** No archived card of that kind by that id in this shop, or the restorer is not a live person here. */
  | "not_found"
  /** A live card now holds the same agency and number: re-entered since, never clobbered. */
  | "conflict"
  | CardUndoRefusal;

/**
 * **A card's Undo** (issues #2764, #3701): bring one archived card of `kind`
 * back into every readiness and roster read, as the same row with the same
 * review state, and write the restore to the activity log under the staffer
 * who tapped it.
 *
 * Only a staffer's own delete comes back, and only inside the window
 * (`cardUndoRefusal`, `src/lib/card-undo.ts`): a card DiveDay archived in
 * favor of other evidence, or one deleted long enough ago that the toast is
 * gone, is entered again and sighted. The rule is asked of the row read under
 * the diver's lock and stated again in the writing statement, so no read
 * between the two can put back a card the rule would refuse.
 *
 * Refuses rather than clobbers when a live card holds the same shop, agency
 * and number: the partial unique index would reject it, and a re-entered card
 * must never be overwritten by an undo.
 */
export async function restoreCard(
  db: AppDb,
  input: {
    shopId: string;
    kind: "level" | "specialty" | "nitrox";
    certificationId: string;
    /** The staffer who tapped Undo, named on the activity line. */
    restoredByPersonId: string;
    now?: Date;
  },
): Promise<CardRestoreOutcome> {
  if (![input.shopId, input.certificationId, input.restoredByPersonId].every(isUuid)) {
    return "not_found";
  }
  const now = input.now ?? nowDate();
  const byId = and(
    eq(cards.kind, input.kind),
    eq(cards.id, input.certificationId),
    eq(cards.shopId, input.shopId),
  );
  const [archived] = await db
    .select({ personId: cards.personId, deletedAt: cards.deletedAt })
    .from(cards)
    .where(byId)
    .limit(1);
  if (!archived || archived.deletedAt === null) return "not_found";
  try {
    return await db.transaction(async (tx): Promise<CardRestoreOutcome> => {
      const [diver] = await tx
        .select({ id: people.id, fullName: people.fullName })
        .from(people)
        // diveday:allow-deleted-people: deleted divers retain their cards for restoration.
        .where(and(eq(people.id, archived.personId), eq(people.shopId, input.shopId)))
        .for("no key update");
      if (!diver) return "not_found";
      const [actor] = await tx
        .select({ fullName: people.fullName })
        .from(people)
        .where(
          and(
            eq(people.id, input.restoredByPersonId),
            eq(people.shopId, input.shopId),
            livePerson(),
          ),
        )
        .limit(1);
      if (!actor) return "not_found";
      const [current] = await tx
        .select()
        .from(cards)
        .where(and(byId, eq(cards.personId, diver.id)))
        .limit(1);
      if (!current || current.deletedAt === null) return "not_found";
      const refusal = cardUndoRefusal(
        { deletedAt: current.deletedAt, deletionKind: current.deletionKind },
        now,
      );
      if (refusal) return refusal;
      const [conflict] = await tx
        .select({ id: cards.id })
        .from(cards)
        .where(
          and(
            eq(cards.kind, input.kind),
            eq(cards.shopId, input.shopId),
            eq(cards.agency, current.agency),
            sql`lower(${cards.identifier}) = lower(${current.identifier})`,
            isNull(cards.deletedAt),
          ),
        )
        .limit(1);
      if (conflict) return "conflict";
      const [row] = await tx
        .update(cards)
        .set({ deletedAt: null, deletedByPersonId: null, deletionKind: null })
        .where(
          and(byId, eq(cards.deletionKind, "staff"), gte(cards.deletedAt, cardUndoCutoff(now))),
        )
        .returning({ id: cards.id });
      if (!row) return "not_found";
      await tx.insert(activityEvents).values({
        shopId: input.shopId,
        tripId: null,
        bookingId: null,
        actorPersonId: input.restoredByPersonId,
        // The diver's record claims this line by its subject (`addDiverNote`'s shape).
        subjectPersonId: diver.id,
        code: "card_restored",
        params: { actor: actor.fullName, diver: diver.fullName, cardType: input.kind },
        occurredAt: now,
      });
      return "restored";
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) return "conflict";
    throw error;
  }
}
