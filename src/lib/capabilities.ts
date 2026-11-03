/**
 * **One table of bearer capabilities, one policy row per purpose** (issue
 * #2710, from the 2026-09-18 review's L04-1 "Nine token tables are one
 * capabilities table").
 *
 * A capability is a URL-is-the-credential link a shop mails out: possession is
 * the authorization, so the token is 256 random bits and the database keeps
 * only its digest (`src/lib/bearer-tokens.ts`). Each kind used to own a table,
 * a module and a lifecycle. They are moving onto one `capabilities` table
 * (`src/db/schema/capabilities.ts`), one at a time, and every purpose that has
 * moved has exactly one row here. The table module (`src/db/capabilities.ts`)
 * reads this record and nothing else to decide which subject column a row
 * names, so a purpose cannot be issued against the wrong kind of subject.
 *
 * The first two purposes are the two email-unsubscribe links behind
 * `/unsubscribe/[token]`. Purposes still on their own tables (booking
 * capabilities, account tokens, calendar feeds, waiver links, shore-alert and
 * weekly-digest links) are the rest of #2710.
 *
 * This file is the source of the `capability_purpose` pg enum, so the union
 * and the database cannot drift. It is named for the table rather than for
 * `booking_capabilities`, whose own `CapabilityPurpose` union in
 * `src/db/booking-capabilities.ts` folds in here when that table moves.
 */
export const CAPABILITY_PURPOSES = ["interest_unsubscribe", "courtesy_email_unsubscribe"] as const;

export type CapabilityPurpose = (typeof CAPABILITY_PURPOSES)[number];

/**
 * The one thing a capability opens, as a typed column on the row. `interest`
 * is `capabilities.interest_id`; `person` is `capabilities.person_id`. The
 * table's `capabilities_subject_by_purpose` check holds every row to its
 * purpose's subject, and keeps the other subject column null.
 */
export type CapabilitySubject = "interest" | "person";

export type CapabilityPolicy = {
  subject: CapabilitySubject;
  /**
   * `never`: the row carries no expiry. An unsubscribe link must keep working
   * for as long as the email it rode in on can be opened, or someone is left
   * unable to stop the mail, silently. A purpose that expires adds its
   * lifetime here, and its `expires_at` column, when it moves.
   */
  lifetime: "never";
  /**
   * `idempotent`: opening the link performs one write that is the same on
   * every use (close the interest, stamp the opt-out), so the row is never
   * marked used and an old email's link still reads as "already done" rather
   * than as a dead link.
   */
  use: "idempotent";
};

export const CAPABILITY_POLICY = {
  // One anytime interest (the last-minute list). Opening it closes that
  // interest as `unsubscribed`. Minted once per deal email, per recipient.
  interest_unsubscribe: { subject: "interest", lifetime: "never", use: "idempotent" },
  // One person's courtesy email: wait-list openings, recaps, checkout
  // reminders, cold staff invitations. Opening it sets
  // `people.courtesy_email_opt_out_at`. Minted once per courtesy send.
  courtesy_email_unsubscribe: { subject: "person", lifetime: "never", use: "idempotent" },
} as const satisfies Record<CapabilityPurpose, CapabilityPolicy>;

/** The subject a purpose's rows name. */
export function capabilitySubject(purpose: CapabilityPurpose): CapabilitySubject {
  return CAPABILITY_POLICY[purpose].subject;
}
