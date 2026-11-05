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
 * The purposes here are the email-unsubscribe links behind
 * `/unsubscribe/[token]` (issue #3721 moved the rest of them in) and the first
 * expiring purpose, the shore contact's confirm link. Purposes still on their
 * own tables (account tokens, calendar feeds, waiver links, setup links, the
 * front desk's and the bookkeeper's confirm links) are the rest of #2710.
 * Booking links stay on `booking_capabilities`: they are derived from their
 * row (ADR 20261104-derived-booking-link-tokens), and this table is keyed by
 * the digest of a random token.
 *
 * This file is the source of the `capability_purpose` pg enum, so the union
 * and the database cannot drift. It is named for the table rather than for
 * `booking_capabilities`, whose own `CapabilityPurpose` union in
 * `src/db/booking-capabilities.ts` folds in here when that table moves.
 */
export const CAPABILITY_PURPOSES = [
  "interest_unsubscribe",
  "courtesy_email_unsubscribe",
  "weekly_digest_unsubscribe",
  "shore_alert_stop",
  "bookkeeper_stop",
  "shore_alert_confirm",
] as const;

export type CapabilityPurpose = (typeof CAPABILITY_PURPOSES)[number];

/**
 * The one thing a capability opens, as a typed column on the row. `interest`
 * is `capabilities.interest_id`; `person` is `capabilities.person_id`;
 * `shop_address` is one of the row's own shop's addresses (the shore contact,
 * the bookkeeper), named by `capabilities.sent_to`, the lower-cased address
 * the link was mailed to: the shop has no inbox of its own, and a link must
 * never act on a later, different address. The table's
 * `capabilities_subject_by_purpose` check holds every row to its purpose's
 * subject, and keeps the other subject columns null.
 */
export type CapabilitySubject = "interest" | "person" | "shop_address";

export type CapabilityPolicy = {
  subject: CapabilitySubject;
  /**
   * `never`: the row carries no expiry. An unsubscribe link must keep working
   * for as long as the email it rode in on can be opened, or someone is left
   * unable to stop the mail, silently.
   *
   * `expires`: the row carries `expires_at`, set by the caller from its own
   * rule, and the link opens nothing after it. The table's
   * `capabilities_expiry_by_purpose` check holds every row to this field.
   */
  lifetime: "never" | "expires";
  /**
   * `adds`: each mint is one more working link; earlier ones keep working.
   *
   * `supersedes`: minting a link revokes (`revoked_at`) every live link of the
   * same purpose the shop holds, so only the newest works.
   */
  reissue: "adds" | "supersedes";
  /**
   * `idempotent`: opening the link performs one write that is the same on
   * every use (close the interest, stamp the opt-out), so the row is never
   * marked used and an old email's link still reads as "already done" rather
   * than as a dead link.
   *
   * `once`: opening it is spent (`capabilities.used_at`), so after the shop
   * names the same address again an old link cannot take it off a second
   * time. A spent link still verifies, and reads as "already done".
   */
  use: "idempotent" | "once";
};

export const CAPABILITY_POLICY = {
  // One anytime interest (the last-minute list). Opening it closes that
  // interest as `unsubscribed`. Minted once per deal email, per recipient.
  interest_unsubscribe: {
    subject: "interest",
    lifetime: "never",
    reissue: "adds",
    use: "idempotent",
  },
  // One person's courtesy email: wait-list openings, recaps, checkout
  // reminders, cold staff invitations. Opening it sets
  // `people.courtesy_email_opt_out_at`. Minted once per courtesy send.
  courtesy_email_unsubscribe: {
    subject: "person",
    lifetime: "never",
    reissue: "adds",
    use: "idempotent",
  },
  // One staffer's Monday email (`src/features/weekly-digest`). Opening it sets
  // `user_accounts.weekly_digest` to false. Minted once per digest sent, after
  // that week's send claim lands (issue #3721).
  weekly_digest_unsubscribe: {
    subject: "person",
    lifetime: "never",
    reissue: "adds",
    use: "idempotent",
  },
  // The stop link every stale roll-call alert carries to the shop's shore
  // contact (H-20261014-stale-roll-call-recipients). Opening it clears the
  // shop's shore contact while the shop still names the address it went to.
  // Minted once per alert (issue #3721).
  shore_alert_stop: { subject: "shop_address", lifetime: "never", reissue: "adds", use: "once" },
  // The stop link each month-end email carries to the shop's bookkeeper (ADR
  // 20261016-bookkeeper-month-end-email, second-pass N1). Opening it clears
  // the bookkeeper's address while the shop still names the address it went
  // to. Minted with each month's claim; a new or cleared address withdraws
  // the unspent ones (issue #3721).
  bookkeeper_stop: { subject: "shop_address", lifetime: "never", reissue: "adds", use: "once" },
  // The one-time link a newly saved shore contact receives before any alert
  // goes to it (H-20261014-stale-roll-call-recipients review). Opening it sets
  // `shops.shore_alert_confirmed_at` while the shop still names the address it
  // went to. Expires (`SHORE_ALERT_CONFIRMATION_TTL_MS`); a fresh mint
  // revokes the outstanding one (issue #3721).
  shore_alert_confirm: {
    subject: "shop_address",
    lifetime: "expires",
    reissue: "supersedes",
    use: "once",
  },
} as const satisfies Record<CapabilityPurpose, CapabilityPolicy>;

/** The subject a purpose's rows name. */
export function capabilitySubject(purpose: CapabilityPurpose): CapabilitySubject {
  return CAPABILITY_POLICY[purpose].subject;
}

/** The purposes whose rows name `subject`. */
export function purposesNaming(subject: CapabilitySubject): CapabilityPurpose[] {
  return CAPABILITY_PURPOSES.filter((purpose) => CAPABILITY_POLICY[purpose].subject === subject);
}

/** The purposes whose rows carry `expires_at`. */
export function expiringPurposes(): CapabilityPurpose[] {
  return CAPABILITY_PURPOSES.filter((purpose) => CAPABILITY_POLICY[purpose].lifetime === "expires");
}

/** The purposes a use spends. */
export function spentPurposes(): CapabilityPurpose[] {
  return CAPABILITY_PURPOSES.filter((purpose) => CAPABILITY_POLICY[purpose].use === "once");
}
