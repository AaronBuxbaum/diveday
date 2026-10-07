import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { bookings } from "./bookings";
import { people, shops } from "./core";
import { notificationDeliveryStatus, notificationProviderStatus } from "./notifications";

/**
 * Waiver templates, materiality decisions, waiver records (with medical
 * answers) and their deliveries.
 */

/**
 * A template is versioned by insertion, never by mutation. A record captures
 * a text snapshot too, so even a later archive cannot alter signed history.
 */
export const waiverTemplates = pgTable(
  "waiver_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    title: text("title").notNull(),
    version: integer("version").notNull(),
    /**
     * Legal-term generation. Versions still increment for every edit, while
     * this counter advances only when the publisher says the edit changes what
     * a diver agreed to (issue #738). Never infer that answer from a diff.
     */
    materialGeneration: integer("material_generation").notNull().default(1),
    body: text("body").notNull(),
    /** Soft delete, spelled the one way every other entity spells it (ADR 20260820-every-delete-is-soft). */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // A shop has exactly one waiver — versions increment per shop, not per
    // (shop, title): saveWaiverTemplate already computes the next version
    // shop-wide with no title filter, so the DB constraint now matches that
    // real invariant instead of a looser one that could let two different
    // titles both claim "version 2" at the same shop (CR-015).
    uniqueIndex("waiver_templates_shop_version_unique").on(table.shopId, table.version),
  ],
);

/** The accountable human assertion that a waiver version is (or is not) material. */
export const waiverMaterialityDecisions = pgTable(
  "waiver_materiality_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    templateId: uuid("template_id")
      .notNull()
      .references(() => waiverTemplates.id),
    material: boolean("material").notNull(),
    actorPersonId: uuid("actor_person_id")
      .notNull()
      .references(() => people.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
    seq: bigserial("seq", { mode: "number" }).notNull(),
  },
  (table) => [index("waiver_materiality_decisions_shop_idx").on(table.shopId, table.templateId)],
);

/**
 * The ways a shop can hand a waiver link over. `link` is not a delivery in the
 * postal sense — nothing was sent — but it is still a fact worth keeping: the
 * staffer took the URL and is passing it on themselves, and the record of that
 * is what stops the diver's record reading "never sent".
 */
export const waiverDeliveryChannel = pgEnum("waiver_delivery_channel", ["email", "text", "link"]);

export const waiverRecordStatus = pgEnum("waiver_record_status", [
  "pending",
  "completed",
  "medical_review",
]);

/**
 * A completed diver medical questionnaire. Stores the questionnaire id and
 * version it was answered against (src/lib/medical.ts) so signed evidence is
 * never re-interpreted by a later edit to the question set; `responses` maps
 * each question id to the diver's yes(true)/no(false) answer.
 */
export type MedicalAnswers = {
  questionnaireId: string;
  questionnaireVersion: number;
  responses: Record<string, boolean>;
};

/**
 * The guardian section of a minor's release as last saved for later — the
 * sibling of `draft_signer_name`. Strings as typed, unvalidated: what a parent
 * finds when they come back to the link, never what the record attests to.
 */
export type DraftGuardian = {
  name: string | null;
  relationship: string | null;
  email: string | null;
  /** The guardian's own consent tick, kept across a refusal exactly as `draft_acknowledged` is. */
  acknowledged: boolean;
};

/**
 * One issued link gets one row. Pending rows may be superseded; completed rows
 * are immutable evidence and never updated or re-used for a new template.
 */
export const waiverRecords = pgTable(
  "waiver_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    /**
     * Where the shop was standing when the record was filed, when that was
     * anywhere in particular. `personId` below is what actually satisfies the
     * sign-once gate, on this booking and every other.
     *
     * Null on two paths, both of which have no seat to name: an imported
     * record (`signatureMethod: "imported"` — a contact import creates people,
     * not bookings), and a staff-attested paper release recorded from the
     * diver's own record, where the conversation is about the person and they
     * may hold no booking at all (ADR 20260811-person-scoped-paper-waivers).
     * A digital token may be booking-scoped or person-scoped; the public waiver
     * page handles both contexts without making a schedule part of signing.
     */
    bookingId: uuid("booking_id").references(() => bookings.id),
    /**
     * The diver the signed release belongs to, denormalized from the booking so
     * a completed waiver is queryable per person. A diver signs once: a current
     * completed record satisfies the waiver gate on any of their bookings at the
     * shop (src/lib/waivers.ts — effectiveWaiverForBooking), so this is not
     * redundant with `bookingId`, which still records where the link was issued.
     */
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    templateId: uuid("template_id")
      .notNull()
      .references(() => waiverTemplates.id),
    templateTitle: text("template_title").notNull(),
    templateVersion: integer("template_version").notNull(),
    /** The material generation the signer agreed to, separate from display version. */
    templateGeneration: integer("template_generation").notNull().default(1),
    templateBody: text("template_body").notNull(),
    status: waiverRecordStatus("status").notNull().default("pending"),
    /** Latest delivery outcome for a digital link; null for paper/imported records. */
    deliveryStatus: notificationDeliveryStatus("delivery_status"),
    deliveryProviderMessageId: text("delivery_provider_message_id"),
    deliveryProviderStatus: notificationProviderStatus("delivery_provider_status"),
    deliveryProviderStatusAt: timestamp("delivery_provider_status_at", { withTimezone: true }),
    deliveryError: text("delivery_error"),
    /** SHA-256 hash — what every lookup matches against, and all that is kept once the link is spent. */
    tokenHash: text("token_hash").notNull().unique(),
    /**
     * The same bearer token, sealed (`src/lib/secret-box.ts`), for exactly as
     * long as the link is live.
     *
     * It exists so a second "send this diver their waiver" hands back the link
     * they already have instead of minting a new one and killing the old
     * (ADR 20260820-waiver-links-are-reused-not-reissued). A hash alone cannot
     * do that — nothing can read it back — so the choice was between reissuing
     * (a copied URL dies the moment anyone taps Text, and a diver mid-draft
     * loses it) and keeping an openable copy under the deployment's own key.
     *
     * Bounded on purpose: written only for a live pending link, and nulled the
     * moment the record is superseded, completed, or the diver's data erased.
     * A database reader cannot replay a spent credential, and a live one needs
     * `SECRET_ENCRYPTION_KEY`, which is not in the database. Null wherever no
     * link was ever handed out (paper, imported, anonymized) and wherever the
     * deployment has no sealing key, in which case issuing falls back to
     * minting a fresh link exactly as it did before.
     *
     * One case keeps its ciphertext: a link nobody ever reissued over, left to
     * expire. Nothing opens it again — reuse refuses an expired record, and the
     * next issue supersedes and clears it — and what it seals is a token that
     * now resolves to `expired`, so it is not a live credential. Clearing it on
     * the stroke of expiry would want a sweeper, which is more moving parts
     * than the exposure justifies.
     */
    tokenSealed: text("token_sealed"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    draftSignerName: text("draft_signer_name"),
    draftAcknowledged: boolean("draft_acknowledged").notNull().default(false),
    draftMedicalAnswers: jsonb("draft_medical_answers").$type<MedicalAnswers>(),
    signedName: text("signed_name"),
    signatureMethod: text("signature_method"),
    /**
     * The staff member who attested an in-person / paper signature. Null for a
     * diver's own self-service completion — set only when a non-diver records a
     * release the app never saw signed, so the accountable person is on record.
     */
    recordedByPersonId: uuid("recorded_by_person_id").references(() => people.id),
    consentedAt: timestamp("consented_at", { withTimezone: true }),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    medicalAnswers: jsonb("medical_answers").$type<MedicalAnswers>(),
    medicalReviewRequired: boolean("medical_review_required").notNull().default(false),
    /**
     * **A physician cleared this diver to dive, and a staff member recorded it.**
     *
     * The questionnaire refers a diver for physician evaluation and the record
     * parks in `medical_review`, which fails closed (`src/lib/readiness.ts`).
     * What happens next in a real shop is that the diver comes back holding a
     * signed physician evaluation — and until this existed there was nowhere to
     * put that. The only path that lifted the block was a paper attestation
     * whose staff-facing words are "no answer needs physician sign-off", the
     * opposite of what the diver is standing there with, so a staffer either
     * attested to something untrue or left a cleared diver blocked (issue
     * #1252).
     *
     * Deliberately **not** a widening of that attestation, and deliberately not
     * implicit in a tap on "Mark ready": clearing a referral is a different act
     * with a different evidence trail, and conflating the two would make the
     * record unable to say which one happened.
     *
     * It clears *this record* and nothing else, which is what binds it to one
     * questionnaire version: the answers that were referred are on this row
     * (`medical_answers`), so a later disclosure signs a new record and parks
     * again with this clearance untouched. Fails closed on absence — null is
     * every record that has not been cleared, including every record that never
     * needed to be.
     *
     * Outside the integrity seal, like `superseded_at` and the delivery
     * columns: `signedMetadata` seals the diver's signed evidence, and a
     * clearance is a later act by the shop rather than part of what the diver
     * agreed to. `anonymized_at` is inside the v2 seal only because erasure
     * *destroys* sealed fields and would otherwise read as tampering.
     */
    medicalClearedAt: timestamp("medical_cleared_at", { withTimezone: true }),
    /** The staff member who recorded the clearance — the accountable person, as `recorded_by_person_id` is for a paper signature. */
    medicalClearedByPersonId: uuid("medical_cleared_by_person_id").references(() => people.id),
    /**
     * The physician's evaluation, re-stored through DiveDay's own image
     * pipeline like an imported waiver document. Optional: a shop that keeps
     * the paper in a folder still records the fact.
     *
     * Destroyed by `anonymizeDiver` — it is the diver's own medical document,
     * the same class of thing as `import_source_medical_document_url`. The
     * *fact* of the clearance survives the erasure, as the certification
     * sighting does.
     */
    medicalClearanceDocumentUrl: text("medical_clearance_document_url"),
    /**
     * **The day the physician actually evaluated the diver**, which is not the
     * day a staffer typed it in.
     *
     * `medical_cleared_at` is a data-entry timestamp, and a `dive-domain-expert`
     * review was blunt about what happens if that is all a shop holds: a diver
     * walks up with a "fit to dive" letter from 2023 and DiveDay records a
     * clearance dated today, saying nothing about the letter's age. Worse, a
     * letter written in March cannot clear a stent placed in June — so a
     * clearance is refused unless it post-dates the disclosure it answers
     * (`recordMedicalClearance`).
     *
     * A calendar date, not an instant: what is printed on the form is a day,
     * and it has no clock in it. It is also half the currency window — a
     * cleared release stands until the *earlier* of a year from the signature
     * and a year from the evaluation (`isCompletedWaiverCurrent`), which is the
     * twelve months agency standards and operators actually work to.
     */
    medicalClearanceEvaluatedOn: date("medical_clearance_evaluated_on", { mode: "string" }),
    /**
     * The clinician who signed the evaluation, when the shop keeps the paper
     * rather than uploading it.
     *
     * One of this and the document is required. Without either, the record says
     * only that one of the shop's own staff pressed a button — which is the
     * hearsay the paper-waiver attestation's checkbox exists to avoid, and this
     * act deliberately has no checkbox because attaching the evidence is the
     * better version of the same assurance.
     */
    medicalClearancePhysicianName: text("medical_clearance_physician_name"),
    /**
     * **The physician answered, and the answer was no** (issue #1283).
     *
     * The RSTC Physician's Evaluation Form has two outcomes and DiveDay only
     * modelled one. A diver who came back disapproved left the record parked in
     * `medical_review` — safe, and correctly fail-closed, but indistinguishable
     * from *we are still waiting*. So the shop kept chasing a diver whose answer
     * had already arrived, Today kept surfacing the row as outstanding work, and
     * the crew never learned that the answer was no.
     *
     * **Deliberately not `medical_cleared_at` carrying a second meaning.** That
     * column is the pivot every constraint and every consumer keys off:
     * `isCleanCompletion` reads it as a signed release, `isCompletedWaiverCurrent`
     * shortens the currency window on it, and readiness lifts the hold on it.
     * Recording a refusal there would read as *cleared* to all three — the exact
     * inversion of the safety property — so a refusal gets its own column and the
     * two are mutually exclusive by check constraint.
     *
     * **The block stands.** This is not a second kind of clearance; it is the
     * absence of one, recorded. `isUnresolvedMedicalHold` still holds the diver
     * off the boat, and the only thing that changes is that the surfaces can stop
     * saying "waiting" and the shop can stop chasing.
     *
     * **Final for this record.** A refusal is never overwritten by a later
     * clearance: a physician who re-evaluates a diver is answering a fresh
     * disclosure, which signs a new record and parks a new hold. Letting a
     * clearance land on top of a refusal would make a recorded "no" erasable by
     * whoever is at the desk next.
     */
    medicalClearanceDeclinedAt: timestamp("medical_clearance_declined_at", {
      withTimezone: true,
    }),
    /** The staff member who recorded the refusal — `medical_cleared_by_person_id`'s twin, and accountable the same way. */
    medicalClearanceDeclinedByPersonId: uuid("medical_clearance_declined_by_person_id").references(
      () => people.id,
    ),
    /**
     * **The guardian's half of a minor's release** (ADR
     * 20260907-guardian-co-signature). A diver under the age of majority on
     * the day they sign (`src/lib/guardian.ts`, over `people.date_of_birth`)
     * has a parent or legal guardian sign the same release, on the same page,
     * with the same typed-consent evidence the diver's own signature takes —
     * so these five columns are the diver's `signed_name` /
     * `signature_method` / `consented_at` / `signed_at` block a second time,
     * plus who the co-signer is to the diver (a code, `GuardianRelationship`)
     * and how to reach them.
     *
     * All null on every record a guardian never touched: an adult's, a
     * diver's with no date of birth on file (the rule fails open, as H-08's
     * does), and every record signed before this shipped. **Null on a minor's
     * record is the block**: `guardianSignatureMissing` raises
     * `guardian_signature_missing` in readiness, and the issue path refuses to
     * treat that record as standing so a fresh link can collect both
     * signatures. The guardian is *not* a `people` row — they are a party to
     * one document, not a customer, and giving them a record would invent a
     * diver the shop never met.
     *
     * Inside the integrity seal (`src/lib/waiver-integrity.ts`, v1), because a
     * guardian's signature removed after the fact is the tampering the seal
     * exists to catch. `guardian_name` and `guardian_email` are personal data
     * of a third party and go with the diver's own under erasure
     * (`src/db/anonymize.ts`); the fact and date of the co-signature survive,
     * exactly as the diver's `signed_at` does.
     */
    guardianName: text("guardian_name"),
    guardianRelationship: text("guardian_relationship"),
    guardianEmail: text("guardian_email"),
    guardianSignatureMethod: text("guardian_signature_method"),
    guardianConsentedAt: timestamp("guardian_consented_at", { withTimezone: true }),
    guardianSignedAt: timestamp("guardian_signed_at", { withTimezone: true }),
    /**
     * The guardian section as last saved with "Save and finish later" — the
     * sibling of `draft_signer_name`, so a parent who comes back to the link
     * finds their own fields as they left them. Unsubmitted state, never
     * evidence: excluded from the export bundle with the other drafts, and
     * stripped by erasure.
     */
    draftGuardian: jsonb("draft_guardian").$type<DraftGuardian>(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** HMAC over the immutable signed metadata; null means legacy/unverified. */
    integrityHash: text("integrity_hash"),
    integrityVersion: integer("integrity_version"),
    /**
     * Provenance for an imported record (ADR 20260724-import-waiver-acceptance):
     * a free-text label of the prior shop/system the row named, and any
     * source document(s) re-stored through DiveDay's own image pipeline
     * (never rendered from the raw import URL directly). All null for a
     * record created any other way.
     */
    importedFromLabel: text("imported_from_label"),
    importSourceDocumentUrl: text("import_source_document_url"),
    importSourceMedicalDocumentUrl: text("import_source_medical_document_url"),
    /**
     * Set when this record was stripped of the signer's name, medical answers,
     * and source documents as part of erasing the diver
     * (ADR 20260802-diver-data-erasure), and re-sealed under integrity
     * **version 2** — the HMAC over exactly the fields that survive erasure.
     * A v1 seal covers `signed_name` and `medical_answers`, so a stripped
     * record can never verify against it; without the re-seal every erased
     * release would read as *tampered* rather than as *erased*. Stamped in the
     * same statement as the strip, and part of the v2 metadata itself, so the
     * erasure is inside the seal rather than an unsealed annotation beside it.
     */
    anonymizedAt: timestamp("anonymized_at", { withTimezone: true }),
    /** The shop owner who ordered the erasure — see `people.anonymized_by_person_id`. */
    anonymizedByPersonId: uuid("anonymized_by_person_id").references(() => people.id),
    /**
     * Set when the release was refiled under another diver record (issue
     * #2080): a diver merge moves every release of the record merged away
     * (`refileWaiverRecords`), and a split held seat takes its *unsigned* links
     * with it (`splitBookingIdentity`). `moved_from_person_id` is the record it
     * was filed under before, `moved_by_person_id` the staffer who did it.
     *
     * Inside the seal (integrity **version 3**, `src/lib/waiver-integrity.ts`)
     * whenever the release was sealed: `person_id` is sealed, so a refiled
     * release can only verify if the move itself is part of what the seal
     * says. Null on every record that never moved.
     */
    movedFromPersonId: uuid("moved_from_person_id").references(() => people.id),
    movedAt: timestamp("moved_at", { withTimezone: true }),
    movedByPersonId: uuid("moved_by_person_id").references(() => people.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("waiver_records_booking_current_idx").on(table.bookingId, table.supersededAt),
    index("waiver_records_shop_status_idx").on(table.shopId, table.status),
    // The per-person carry-forward lookup: a diver's completed releases at a shop.
    index("waiver_records_shop_person_status_idx").on(table.shopId, table.personId, table.status),
    // A physician's answer without an accountable staff member is not a record
    // of anything, and a document with no answer beside it is a file nobody
    // claimed. Both outcomes carry the same obligation, and a record can hold
    // only one of them: a clearance and a refusal on the same row would leave
    // every reader to guess which one the shop meant (issue #1283).
    check(
      "waiver_records_medical_clearance_attributed",
      sql`(${table.medicalClearedAt} is null) = (${table.medicalClearedByPersonId} is null)
        and (${table.medicalClearanceDeclinedAt} is null) = (${table.medicalClearanceDeclinedByPersonId} is null)
        and (${table.medicalClearedAt} is null or ${table.medicalClearanceDeclinedAt} is null)
        and (${table.medicalClearanceDocumentUrl} is null
          or ${table.medicalClearedAt} is not null
          or ${table.medicalClearanceDeclinedAt} is not null)`,
    ),
    // Nothing to clear unless the questionnaire referred this diver. Written
    // against `medical_review_required` rather than `status`, because that
    // column is the fact about the answers and does not move when the record's
    // lifecycle does.
    check(
      "waiver_records_medical_clearance_needs_referral",
      sql`(${table.medicalClearedAt} is null and ${table.medicalClearanceDeclinedAt} is null)
        or ${table.medicalReviewRequired}`,
    ),
    // An answer — cleared or not cleared — says when the physician evaluated
    // the diver, and points at either their evaluation or their name. Neither
    // is optional, because without them the row records only that a staff
    // member pressed a button. A refusal earns the requirement more than a
    // clearance does: it is the one that keeps a paying diver off the boat.
    //
    // **Except after an erasure**, which destroys both: `anonymizeDiver` nulls
    // the document URL, and a clearance evidenced only by a document would then
    // fail this check and take the whole erasure transaction with it. The
    // erased row is *meant* to be a skeleton — the certification sighting
    // survives its agency number the same way — so the rule is about a live
    // record, and the exemption is stated rather than discovered by a failing
    // erasure in production.
    check(
      "waiver_records_medical_clearance_evidenced",
      sql`(${table.medicalClearedAt} is null and ${table.medicalClearanceDeclinedAt} is null)
        or ${table.anonymizedAt} is not null or (
        ${table.medicalClearanceEvaluatedOn} is not null
        and (${table.medicalClearanceDocumentUrl} is not null
          or ${table.medicalClearancePhysicianName} is not null))`,
    ),
    // A guardian's signature is one act with four facts: when they signed,
    // when they consented, by which provider, and who they are to the diver.
    // Either all four are there or none is — a `guardian_signed_at` with no
    // relationship would render as a co-signature by nobody in particular.
    // The name and email are deliberately outside this rule: erasure strips
    // them and the signature's fact survives (ADR 20260907-guardian-co-signature).
    check(
      "waiver_records_guardian_signature_whole",
      sql`(${table.guardianSignedAt} is null) = (${table.guardianConsentedAt} is null)
        and (${table.guardianSignedAt} is null) = (${table.guardianSignatureMethod} is null)
        and (${table.guardianSignedAt} is null) = (${table.guardianRelationship} is null)`,
    ),
  ],
);

/**
 * What we know about each *way* a waiver link was handed over — one row per
 * record per channel, holding the current state of that channel.
 *
 * It sits beside `waiver_records.delivery_*` rather than replacing it, and the
 * split is the same one `notification_deliveries` and
 * `notification_delivery_attempts` already draw: the record's own columns are
 * the **latest attempt on this link, whichever channel it used** — what the
 * webhook keys on and what `getDiverWaiverRequestStatus` answers "has this
 * diver been reached at all?" from — while these rows are **per channel**, and
 * exist because the two questions have different answers the moment a shop
 * emails a diver and then texts them. Without the split, tapping Text erases
 * everything we knew about the email.
 *
 * That is not a nicety: the diver record offers email, text, and link as four
 * peers, and each button wears its own last outcome. A single latest-attempt
 * column can only ever light one of them.
 *
 * Deliberately out of the export bundle (`src/db/export.test.ts`): the outcome
 * a destination system could use is already on `waiver_records.csv`; this is
 * the per-channel mechanics behind it, exactly like
 * `notification_delivery_attempts`.
 *
 * ADR 20260820-waiver-delivery-is-per-channel.
 */
export const waiverDeliveries = pgTable(
  "waiver_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    waiverRecordId: uuid("waiver_record_id")
      .notNull()
      .references(() => waiverRecords.id),
    channel: waiverDeliveryChannel("channel").notNull(),
    status: notificationDeliveryStatus("status").notNull(),
    providerMessageId: text("provider_message_id"),
    /** Null until a delivery webhook says otherwise, which is the steady state. */
    providerStatus: notificationProviderStatus("provider_status"),
    providerStatusAt: timestamp("provider_status_at", { withTimezone: true }),
    /** The provider's own words for a bounce or failure. */
    detail: text("detail"),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Current state, not history: a second email on the same link replaces the
    // row rather than stacking one. The unique index is what the upsert's
    // `onConflictDoUpdate` targets, so it is load-bearing, not a hint.
    uniqueIndex("waiver_deliveries_record_channel_unique").on(table.waiverRecordId, table.channel),
    // The delivery webhook's only entry point: an event names a message id.
    index("waiver_deliveries_provider_message_idx").on(table.providerMessageId),
    index("waiver_deliveries_shop_record_idx").on(table.shopId, table.waiverRecordId),
  ],
);

export type WaiverRecord = typeof waiverRecords.$inferSelect;
