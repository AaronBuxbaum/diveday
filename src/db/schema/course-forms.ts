import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { bookings } from "./bookings";
import { people, shops } from "./core";
import { courses } from "./courses";

/**
 * **Course forms** (ADR 20261008-course-forms): the documents a course asks
 * each student to sign on top of the shop's one release — an agency's
 * liability release for that course, a safe-diving-practices statement. The
 * shop pastes its own words; DiveDay ships none of an agency's text and never
 * fetches it (H-10).
 *
 * Four tables, because the four facts move at different speeds: a form is an
 * identity the course points at; its words are versioned by insertion, never
 * by mutation, like `waiver_templates`; a course's list of required forms is
 * edited from the course editor; and a signature is immutable evidence that
 * snapshots the words it was given against.
 */

/**
 * A form's identity. Holds no words: the words are `course_form_versions`, so
 * a course requiring "the liability release" keeps requiring it across every
 * edit, and a signed record keeps the exact text it was signed against.
 */
export const courseForms = pgTable(
  "course_forms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    /** Soft delete (ADR 20260820-every-delete-is-soft). A deleted form is required by no course. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("course_forms_shop_live_idx").on(table.shopId).where(sql`${table.deletedAt} is null`),
  ],
);

/**
 * One version of a form's words. Inserted on every edit that changes the title
 * or the body; never updated. The highest `version` for a form is its current
 * text, and only a signature against the current version satisfies the course
 * (`src/lib/course-forms.ts`): a student who signed different words has not
 * agreed to these.
 */
export const courseFormVersions = pgTable(
  "course_form_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    formId: uuid("form_id")
      .notNull()
      .references(() => courseForms.id),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** The staff member who wrote this version. */
    createdByPersonId: uuid("created_by_person_id").references(() => people.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("course_form_versions_form_version_unique").on(table.formId, table.version),
    index("course_form_versions_shop_form_idx").on(table.shopId, table.formId),
  ],
);

/**
 * A course asking every student enrolled on its sessions to sign a form, in
 * the order the shop listed them. Soft-deleted when the course stops asking,
 * so the list a course once had is still on record.
 */
export const courseFormRequirements = pgTable(
  "course_form_requirements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id),
    formId: uuid("form_id")
      .notNull()
      .references(() => courseForms.id),
    position: integer("position").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("course_form_requirements_live_unique")
      .on(table.courseId, table.formId)
      .where(sql`${table.deletedAt} is null`),
    index("course_form_requirements_shop_course_idx").on(table.shopId, table.courseId),
  ],
);

/**
 * **One student's signature on one version of one form, for one enrollment.**
 *
 * Per booking, not per person: a form is about the course the student is on,
 * and the shop's own release is the document that carries forward (ADR
 * 20261008-course-forms). Immutable once written — the title, version and body
 * are snapshots, so a later edit to the form never alters what was signed.
 * The only update any writer makes is erasure (`src/db/anonymize.ts`), which
 * strips the names and keeps the fact.
 *
 * `signature_method` is the same vocabulary as `waiver_records`
 * (`src/lib/signatures.ts`): `typed_consent` when the student signed on their
 * own link, `in_person_attested` when a staffer recorded a paper copy — and
 * then `recorded_by_person_id` names who.
 *
 * The guardian columns are the waiver's own guardian block, minus the email:
 * a minor's form is co-signed by a parent or legal guardian on the same page
 * (ADR 20260907-guardian-co-signature), and a form has no copy to send them.
 */
export const courseFormRecords = pgTable(
  "course_form_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    formId: uuid("form_id")
      .notNull()
      .references(() => courseForms.id),
    formVersionId: uuid("form_version_id")
      .notNull()
      .references(() => courseFormVersions.id),
    formTitle: text("form_title").notNull(),
    formVersion: integer("form_version").notNull(),
    formBody: text("form_body").notNull(),
    /** Null only after erasure (`anonymized_at`), which keeps the fact and drops the name. */
    signedName: text("signed_name"),
    signatureMethod: text("signature_method").notNull(),
    recordedByPersonId: uuid("recorded_by_person_id").references(() => people.id),
    consentedAt: timestamp("consented_at", { withTimezone: true }).notNull(),
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull(),
    guardianName: text("guardian_name"),
    guardianRelationship: text("guardian_relationship"),
    guardianSignatureMethod: text("guardian_signature_method"),
    guardianConsentedAt: timestamp("guardian_consented_at", { withTimezone: true }),
    guardianSignedAt: timestamp("guardian_signed_at", { withTimezone: true }),
    /** Set when erasure stripped the names (ADR 20260802-diver-data-erasure). */
    anonymizedAt: timestamp("anonymized_at", { withTimezone: true }),
    anonymizedByPersonId: uuid("anonymized_by_person_id").references(() => people.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One signature per enrollment per version: a double submit, or a paper
    // copy recorded while the student signs online, settles on the first.
    uniqueIndex("course_form_records_booking_version_unique").on(
      table.bookingId,
      table.formVersionId,
    ),
    index("course_form_records_shop_booking_idx").on(table.shopId, table.bookingId),
    index("course_form_records_shop_person_idx").on(table.shopId, table.personId),
    check(
      "course_form_records_signature_method_known",
      sql`${table.signatureMethod} in ('typed_consent', 'in_person_attested', 'in_person_attested_namesake')`,
    ),
    // A paper copy names the staffer who recorded it; a student's own
    // signature names nobody else.
    check(
      "course_form_records_paper_attributed",
      sql`(${table.signatureMethod} = 'typed_consent') = (${table.recordedByPersonId} is null)`,
    ),
    // A live record says who signed; only erasure takes the name.
    check(
      "course_form_records_signed_name_present",
      sql`${table.signedName} is not null or ${table.anonymizedAt} is not null`,
    ),
    // The guardian's signature is one act with four facts, as on the release.
    check(
      "course_form_records_guardian_signature_whole",
      sql`(${table.guardianSignedAt} is null) = (${table.guardianConsentedAt} is null)
        and (${table.guardianSignedAt} is null) = (${table.guardianSignatureMethod} is null)
        and (${table.guardianSignedAt} is null) = (${table.guardianRelationship} is null)`,
    ),
  ],
);

export type CourseForm = typeof courseForms.$inferSelect;
export type CourseFormVersion = typeof courseFormVersions.$inferSelect;
export type CourseFormRecord = typeof courseFormRecords.$inferSelect;
