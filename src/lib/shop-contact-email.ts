import { DAY_MS } from "@/lib/clock";

/**
 * The one-time link that proves a shop controls the address it typed as its
 * contact email (issue #1288).
 *
 * **Why proof is needed at all.** The address has always been *displayed* on
 * the shop's public pages; nothing new is disclosed by confirming it. What is
 * new is that it became the `Reply-To` on every email DiveDay sends a diver
 * (ADR 20260902-sender-standards-for-ses), so a typo — or a manager who sets
 * somebody else's address — silently routes diver replies to a third party.
 * Those replies carry medical answers and contact details, because a waiver or
 * readiness email is exactly what a diver replies to.
 *
 * **A shop's token, not an account's.** `account_tokens` is bound to a
 * `user_account_id`; this is a fact about a `shops` row, so it lives in its own
 * table rather than making "which shop did this confirm?" a join through
 * whoever happened to be signed in when the link was sent.
 *
 * The token itself is minted and hashed by the same two helpers the account
 * tokens use (`createAccountToken`/`hashAccountToken`) — one implementation of
 * "32 random bytes, stored as SHA-256" rather than a second spelling of it.
 */

/**
 * Three days, matching `EMAIL_VERIFICATION_TTL_MS`. The same low stakes: it
 * only ever proves an inbox works, and a manager who typed the address on a
 * Friday should still be able to open the link on Monday. Nothing degrades when
 * it lapses — the shop keeps sending, without a `Reply-To`, and saving the
 * field again sends a fresh one.
 */
export const SHOP_CONTACT_EMAIL_TTL_MS = 3 * DAY_MS;

export function shopContactEmailLinkPath(token: string): string {
  return `/confirm-contact/${token}`;
}
