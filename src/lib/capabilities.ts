import { EMAIL_VERIFICATION_TTL_MS, INVITE_TTL_MS, PASSWORD_RESET_TTL_MS } from "./account-tokens";
import { DAY_MS } from "./clock";
import { SETUP_LINK_TTL_MS } from "./setup-links";

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
 * `/unsubscribe/[token]`, the stop and confirm links mailed to a shop's own
 * addresses, and the account tokens (verify, reset, invite), which name a
 * sign-in account and no shop, and the setup link, which names a set-up
 * request and no shop, and the staff calendar feeds, which are opened on every
 * poll and never spent (ADR 20261105-capabilities-shop-id-nullable), and the
 * counter tablet's waiver link, which opens one release for one sitting
 * (ADR 20261105-waiver-folds-into-the-thread), and the release link an email
 * or a text carries to sign a release with no seat (issue #3983).
 * Purposes still on their own tables (the front desk's confirm link) are the
 * rest of #2710.
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
  "email_verification",
  "password_reset",
  "invite",
  "shop_setup",
  "calendar_assignments",
  "calendar_shop_trips",
  "waiver_link",
  "release_link",
] as const;

export type CapabilityPurpose = (typeof CAPABILITY_PURPOSES)[number];

/**
 * The one thing a capability opens, as a typed column on the row. `interest`
 * is `capabilities.interest_id`; `person` is `capabilities.person_id`;
 * `shop_address` is one of the row's own shop's addresses (the shore contact,
 * the bookkeeper), named by `capabilities.sent_to`, the lower-cased address
 * the link was mailed to: the shop has no inbox of its own, and a link must
 * never act on a later, different address. `user_account` is
 * `capabilities.user_account_id`, a sign-in account; `setup_request` is
 * `capabilities.setup_request_id`, a request to be set up that no shop exists
 * for yet. `waiver_record` is `capabilities.waiver_record_id`, one release:
 * the link opens that record and no other, so a seat that changes hands, or
 * terms that change under it, leaves the link opening nothing. The table's
 * `capabilities_subject_by_purpose` check holds every row to its purpose's
 * subject, and keeps the other subject columns null.
 */
export type CapabilitySubject =
  | "interest"
  | "person"
  | "shop_address"
  | "user_account"
  | "setup_request"
  | "waiver_record";

/**
 * What a diver merge does with a `person` purpose's rows (`mergeDiverRecords`).
 *
 * `follows`: the row moves to the kept record, so a link mailed to the
 * merged-away one still acts for the person. Only right for a link that grants
 * nothing (stopping mail).
 *
 * `refuse`: a row on either record stops the merge (`staff_record`), as every
 * staff credential does: authority never follows a merge.
 */
type SubjectFields =
  | { subject: "person"; merge: "follows" | "refuse" }
  | { subject: Exclude<CapabilitySubject, "person">; merge?: never };

/**
 * `adds`: each mint is one more working link; earlier ones keep working.
 *
 * `supersedes`: minting a link revokes (`revoked_at`) every live link of the
 * same purpose `per` the shop (`shop`) or per subject (`subject`: the account,
 * the person), so only the newest works. The mint locks that row first.
 */
type ReissueFields = { reissue: "adds" } | { reissue: "supersedes"; per: "shop" | "subject" };

type CapabilityPolicyFields = SubjectFields & {
  /**
   * `shop`: the row carries the shop that minted it (`shop_id`). `platform`:
   * the link is DiveDay's own and names no shop (an account token: an account
   * belongs to a person, not to a shop's records). The table's
   * `capabilities_scope_by_purpose` check holds `shop_id` null exactly for
   * these.
   */
  scope: "shop" | "platform";
  /**
   * `first_device`: the link opens on one device only. The first device that
   * claims it stores the digest of a secret it keeps in a cookie
   * (`capabilities.claim_hash`); every other device is refused, the claiming
   * one can reload. A QR is a URL any camera can read, so this is what keeps a
   * link shown at a counter to the one phone that scanned it first (attacker
   * review S1). Absent: the link opens wherever it is carried. The table's
   * `capabilities_claim_only_when_claimable` check holds every row to it.
   */
  claim?: "first_device";
  /**
   * `never`: the row carries no expiry. An unsubscribe link must keep working
   * for as long as the email it rode in on can be opened, or someone is left
   * unable to stop the mail, silently.
   *
   * `expires`: the row carries `expires_at`, which the mint sets from the
   * policy's `ttlMs` (a caller never chooses it), and the link opens nothing
   * after it: `openCapability` and `spendCapability` check it at use. The
   * table's `capabilities_expiry_by_purpose` check holds every row to this
   * field.
   */
  lifetime: "never" | "expires";
  /**
   * `idempotent`: opening the link performs one write that is the same on
   * every use (close the interest, stamp the opt-out), so the row is never
   * marked used and an old email's link still reads as "already done" rather
   * than as a dead link.
   *
   * `once`: opening it is spent (`capabilities.used_at`), so after the shop
   * names the same address again an old link cannot take it off a second
   * time. A spent link still verifies, and reads as "already done".
   *
   * `reusable`: the link is a standing credential, opened on every use and
   * never spent (a calendar client polls its feed for ever). `openCapability`
   * is its gate, and refuses it once revoked; each use may stamp
   * `capabilities.last_accessed_at`, which only these purposes carry.
   */
  use: "idempotent" | "once" | "reusable";
};

/**
 * **Two mechanisms, each with one rule** (issue #3954, ADR
 * 20261104-derived-booking-link-tokens). A purpose here is a stored row, and
 * one that expires names its `ttlMs` in this table. A booking link is not a
 * purpose here: it derives from its row by HMAC and keeps its own trip-relative
 * expiry (`src/db/booking-capabilities.ts`), so it never had a time limit to
 * state in a policy.
 *
 * An `idempotent` purpose acts through `verifyCapability`, which answers for a
 * revoked or expired row too, so it must be one that never expires and is
 * never superseded; the type refuses the other combinations.
 */
export type CapabilityPolicy =
  | (CapabilityPolicyFields & ReissueFields & { use: "once"; lifetime: "never" })
  | (CapabilityPolicyFields & ReissueFields & { use: "once"; lifetime: "expires"; ttlMs: number })
  | (CapabilityPolicyFields & { use: "idempotent"; lifetime: "never"; reissue: "adds" })
  | (CapabilityPolicyFields & ReissueFields & { use: "reusable"; lifetime: "never" });

export const CAPABILITY_POLICY = {
  // One anytime interest (the last-minute list). Opening it closes that
  // interest as `unsubscribed`. Minted once per deal email, per recipient.
  interest_unsubscribe: {
    subject: "interest",
    scope: "shop",
    lifetime: "never",
    reissue: "adds",
    use: "idempotent",
  },
  // One person's courtesy email: wait-list openings, recaps, checkout
  // reminders, cold staff invitations. Opening it sets
  // `people.courtesy_email_opt_out_at`. Minted once per courtesy send.
  courtesy_email_unsubscribe: {
    subject: "person",
    merge: "follows",
    scope: "shop",
    lifetime: "never",
    reissue: "adds",
    use: "idempotent",
  },
  // One staffer's Monday email (`src/features/weekly-digest`). Opening it sets
  // `user_accounts.weekly_digest` to false. Minted once per digest sent, after
  // that week's send claim lands (issue #3721).
  weekly_digest_unsubscribe: {
    subject: "person",
    merge: "follows",
    scope: "shop",
    lifetime: "never",
    reissue: "adds",
    use: "idempotent",
  },
  // The stop link every stale roll-call alert carries to the shop's shore
  // contact (H-20261014-stale-roll-call-recipients). Opening it clears the
  // shop's shore contact while the shop still names the address it went to.
  // Minted once per alert (issue #3721).
  shore_alert_stop: {
    subject: "shop_address",
    scope: "shop",
    lifetime: "never",
    reissue: "adds",
    use: "once",
  },
  // The stop link each month-end email carries to the shop's bookkeeper (ADR
  // 20261016-bookkeeper-month-end-email, second-pass N1). Opening it clears
  // the bookkeeper's address while the shop still names the address it went
  // to. Minted with each month's claim; a new or cleared address withdraws
  // the unspent ones (issue #3721).
  bookkeeper_stop: {
    subject: "shop_address",
    scope: "shop",
    lifetime: "never",
    reissue: "adds",
    use: "once",
  },
  // The one-time link a newly saved shore contact receives to confirm it
  // (a badge, not a gate: #4060) (H-20261014-stale-roll-call-recipients review). Opening it sets
  // `shops.shore_alert_confirmed_at` while the shop still names the address it
  // went to. Expires after a week rather than the front desk's three days:
  // the reader is somebody outside the shop, who may not open the mail the day
  // the shop saves their address. A fresh mint revokes the outstanding one
  // (issue #3721).
  shore_alert_confirm: {
    subject: "shop_address",
    scope: "shop",
    lifetime: "expires",
    ttlMs: 7 * DAY_MS,
    reissue: "supersedes",
    per: "shop",
    use: "once",
  },
  // The account tokens (ADRs 20260725-account-lifecycle-emails and
  // 20260726-staff-invite-accounts): each proves control of one sign-in
  // account's own address, so it names the account and no shop. One live token
  // per account and purpose: a second reset request makes the first link dead.
  // Spending one also re-checks, in the same update, that the account is not
  // disabled (`consumeAccountToken`, `src/db/account-tokens.ts`).
  //
  // Confirms a freshly created account's address: low stakes, a generous window.
  email_verification: {
    subject: "user_account",
    scope: "platform",
    lifetime: "expires",
    ttlMs: EMAIL_VERIFICATION_TTL_MS,
    reissue: "supersedes",
    per: "subject",
    use: "once",
  },
  // Sets a new password: a credential over account takeover, so an hour.
  password_reset: {
    subject: "user_account",
    scope: "platform",
    lifetime: "expires",
    ttlMs: PASSWORD_RESET_TTL_MS,
    reissue: "supersedes",
    per: "subject",
    use: "once",
  },
  // Accepts a staff invite: creates a staff sign-in, so a week and no longer.
  invite: {
    subject: "user_account",
    scope: "platform",
    lifetime: "expires",
    ttlMs: INVITE_TTL_MS,
    reissue: "supersedes",
    per: "subject",
    use: "once",
  },
  // The link that opens `/onboard` for one shop, once (ADR
  // 20261009-single-use-setup-links). Minted per set-up request, before any
  // shop exists, so it names the request and no shop; spent in the
  // transaction that creates the shop, which it then records
  // (`spent_by_shop_id`, this purpose only). Goes with its request.
  shop_setup: {
    subject: "setup_request",
    scope: "platform",
    lifetime: "expires",
    ttlMs: SETUP_LINK_TTL_MS,
    reissue: "adds",
    use: "once",
  },
  // A staff member's calendar subscription (ADR
  // 20260730-calendar-feed-subscriptions): their own crewed departures, or
  // (owner and manager) every departure at the shop. Polled by a calendar
  // client for as long as it is subscribed, so it never expires and is never
  // spent; rotating it revokes the live one for that person, and the feed
  // re-derives the person's roles on every fetch. A staff credential, so it
  // never follows a diver merge: a feed on either record refuses it.
  calendar_assignments: {
    subject: "person",
    merge: "refuse",
    scope: "shop",
    lifetime: "never",
    reissue: "supersedes",
    per: "subject",
    use: "reusable",
  },
  calendar_shop_trips: {
    subject: "person",
    merge: "refuse",
    scope: "shop",
    lifetime: "never",
    reissue: "supersedes",
    per: "subject",
    use: "reusable",
  },
  // The counter tablet's waiver link (issue #2743, ADR
  // 20261105-waiver-folds-into-the-thread): staff show it as a QR on the
  // party's waiver panel, and the diver signs their own seat's release on the
  // shop's device. It names the release, not the person, so it carries no
  // readiness authority and opens nothing once the seat changes hands or the
  // terms change. It lasts to the end of the departure day and opens on any
  // phone (issue #4064): the minting caller names the day's end, and two weeks
  // are only a ceiling. The first phone to save a step claims it, and only that
  // phone is shown the medical answers saved through it. Signing spends it, and
  // a fresh QR leaves the one before working (a phone may be half-way through
  // it). A diver merge sets the unsigned release aside, so the link opens
  // nothing after it; a replaced contact revokes it; an erasure deletes the
  // links to the person's releases. It is also what Copy link hands staff for
  // a release with no seat (issue #3983), until the end of that day.
  waiver_link: {
    subject: "waiver_record",
    scope: "shop",
    lifetime: "expires",
    ttlMs: 14 * DAY_MS,
    reissue: "adds",
    use: "once",
    claim: "first_device",
  },
  // The link an email or a text carries to sign a release with no seat (issue
  // #3983). Signed, that release covers every seat the diver holds, so the link
  // goes only to the contact on file and its token never comes back to staff:
  // a staffer who wants a URL to hand over gets a counter link
  // (`waiver_link`) instead. A week, as the mail says; signing spends it. A
  // resend adds a link and leaves the earlier ones working, counter links
  // included: whichever signs, the others open nothing after. A contact change
  // revokes it; an erasure deletes it.
  release_link: {
    subject: "waiver_record",
    scope: "shop",
    lifetime: "expires",
    ttlMs: 7 * DAY_MS,
    reissue: "adds",
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

/** The purposes whose rows name no shop (`scope: "platform"`). */
export function platformPurposes(): CapabilityPurpose[] {
  return CAPABILITY_PURPOSES.filter((purpose) => CAPABILITY_POLICY[purpose].scope === "platform");
}

/**
 * The `person` purposes a diver merge treats as `merge` says: moved to the
 * kept record (`follows`) or refused as a staff credential (`refuse`).
 */
export function personPurposesThatMerge(merge: "follows" | "refuse"): CapabilityPurpose[] {
  return CAPABILITY_PURPOSES.filter((purpose) => {
    const policy: CapabilityPolicy = CAPABILITY_POLICY[purpose];
    return policy.subject === "person" && policy.merge === merge;
  });
}

/** The purposes whose rows carry `expires_at`. */
export function expiringPurposes(): CapabilityPurpose[] {
  return CAPABILITY_PURPOSES.filter((purpose) => CAPABILITY_POLICY[purpose].lifetime === "expires");
}

/** The purposes opened on every use and never spent (`use: "reusable"`). */
export function reusablePurposes(): CapabilityPurpose[] {
  return purposesWhere((policy) => policy.use === "reusable");
}

/** The `person` purposes of which a person holds at most one live link (`per: "subject"`). */
export function onePerPersonPurposes(): CapabilityPurpose[] {
  return purposesWhere(
    (policy) =>
      policy.subject === "person" && policy.reissue === "supersedes" && policy.per === "subject",
  );
}

function purposesWhere(test: (policy: CapabilityPolicy) => boolean): CapabilityPurpose[] {
  return CAPABILITY_PURPOSES.filter((purpose) => test(CAPABILITY_POLICY[purpose]));
}

/** The purposes the first device to open them claims (`claim: "first_device"`). */
export function claimablePurposes(): CapabilityPurpose[] {
  return purposesWhere((policy) => policy.claim === "first_device");
}

/** The purposes a use spends. */
export function spentPurposes(): CapabilityPurpose[] {
  return CAPABILITY_PURPOSES.filter((purpose) => CAPABILITY_POLICY[purpose].use === "once");
}

/**
 * When a link minted at `now` for `purpose` stops working, or null for a
 * purpose that never expires. The one place a deadline is computed.
 */
export function capabilityExpiry(purpose: CapabilityPurpose, now: Date): Date | null {
  const policy: CapabilityPolicy = CAPABILITY_POLICY[purpose];
  return policy.lifetime === "expires" ? new Date(now.getTime() + policy.ttlMs) : null;
}
