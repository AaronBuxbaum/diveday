import type { DiverProfile } from "../_components/shared";

/**
 * **Whether this reader could raise an invoice for this diver, at all.**
 *
 * One predicate, because two surfaces ask it and a disagreement between them is
 * the bug this exists to prevent. `DiverStory` asks it to decide whether to
 * render "New invoice" at the foot of the story; `buildDiverStatus` asks it to
 * decide whether the ledger's **Collect** row carries an act, because that act's
 * only destination — when no order has been raised yet — is the very link the
 * story is deciding about (issue #1926).
 *
 * Spelled apart from either caller so the answer cannot drift: before this, the
 * story gated the link on three facts and the ledger gated its act on none, so
 * the ledger offered a fix whose target the story had already removed.
 *
 * The three facts, and why each is here:
 *
 * - `canManageOrders` — the live `src/db/authz.ts` answer for the signed-in
 *   staffer, which `orders/new` has always enforced and the link learned to ask
 *   in #1920. `undefined` is accepted and read as **no**, for the one caller
 *   that cannot ask: `DiverStory`'s `offersInvoice: false` arm types the prop
 *   `never` on purpose, so a reading that never looked the reader up has no
 *   false answer to give.
 * - `paymentsConnected` — whether the *shop* can take money at all. This half
 *   predates the permission one: with Stripe unconnected there has never been a
 *   link, for anybody.
 * - `deletedAt` — a removed diver is not someone to bill.
 *
 * It deliberately says nothing about the **surface**. `DiverStory`'s
 * `offersInvoice` is a statement about where it is being rendered rather than
 * about the reader, so it stays at that call site.
 */
export function canRaiseInvoiceFor(
  diver: Pick<DiverProfile, "person">,
  reader: { canManageOrders: boolean | undefined; paymentsConnected: boolean },
): boolean {
  return Boolean(reader.canManageOrders) && reader.paymentsConnected && !diver.person.deletedAt;
}
