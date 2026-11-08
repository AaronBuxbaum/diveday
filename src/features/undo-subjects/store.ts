import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "../../db/client";
import { type CardKind, cards, people } from "../../db/schema/index";

/**
 * **What an Undo may put back** (issue #2764). An undo offer arrives as URL
 * params a stranger can type, so its inverse asks these before it restores:
 * whether the person it names was erased, and whose card the offer names.
 */

/**
 * Whether this shop's person has been erased (ADR 20260802-diver-data-erasure).
 * An Undo never brings an erased person's data back: not a card, not a note's
 * text. A person this shop does not hold reads as not erased; the record gate
 * in front of every inverse has already refused it.
 */
export async function isPersonErased(
  db: DbExecutor,
  shopId: string,
  personId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ anonymizedAt: people.anonymizedAt })
    .from(people)
    // diveday:allow-deleted-people: an Undo asks about a removed diver's record too.
    .where(and(eq(people.id, personId), eq(people.shopId, shopId)))
    .limit(1);
  return row?.anonymizedAt != null;
}

/**
 * The person a card of this shop belongs to, when it is a card of the kind the
 * offer names, or null for no such card. Lets a card's Undo refuse an offer
 * that names one diver's record and another diver's card, and an offer that
 * names a level card's Undo with a nitrox card's id.
 */
export async function cardOwner(
  db: DbExecutor,
  shopId: string,
  cardType: CardKind,
  cardId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ personId: cards.personId })
    .from(cards)
    .where(and(eq(cards.id, cardId), eq(cards.shopId, shopId), eq(cards.kind, cardType)))
    .limit(1);
  return row?.personId ?? null;
}
