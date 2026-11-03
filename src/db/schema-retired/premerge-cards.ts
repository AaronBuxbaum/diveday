import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import {
  certificationAgency,
  certificationLevel,
  certificationStatus,
  diveSpecialty,
  people,
  shops,
  trips,
} from "../schema";

/**
 * **The three card tables `cards` replaced, kept declared for one release only**
 * (issue #2722). The release before this one still reads and writes them, and a
 * migration runs while that release is serving, so dropping them in the same
 * deploy that copies their rows into `cards` would break it for the length of
 * the build (expand/contract, docs/engineering/deploy-and-migrations-runbook.md).
 *
 * Only `src/db/migration-schema.ts` exports this file, so drizzle-kit keeps the
 * tables and no application code can import them: `@/db/schema` does not
 * re-export it. The next release deletes this file and drops the tables.
 */

export const premergeCertifications = pgTable(
  "certifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    agency: certificationAgency("agency").notNull(),
    level: certificationLevel("level").notNull(),
    identifier: text("identifier"),
    declaredIdentifier: text("declared_identifier"),
    status: certificationStatus("status").notNull().default("pending"),
    reviewNote: text("review_note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedByPersonId: uuid("reviewed_by_person_id").references(() => people.id),
    agencyCheckedAt: timestamp("agency_checked_at", { withTimezone: true }),
    importedAt: timestamp("imported_at", { withTimezone: true }),
    importedFromLabel: text("imported_from_label"),
    selfDeclaredAt: timestamp("self_declared_at", { withTimezone: true }),
    issuedByShopAt: timestamp("issued_by_shop_at", { withTimezone: true }),
    issuedFromTripId: uuid("issued_from_trip_id").references(() => trips.id, {
      onDelete: "set null",
    }),
    issuedByPersonId: uuid("issued_by_person_id").references(() => people.id),
    processedWithAgencyAt: timestamp("processed_with_agency_at", { withTimezone: true }),
    processedByPersonId: uuid("processed_by_person_id").references(() => people.id),
    juniorStatus: text("junior_status").$type<"junior" | "full">(),
    juniorStatusVerifiedAt: timestamp("junior_status_verified_at", { withTimezone: true }),
    juniorStatusVerifiedByPersonId: uuid("junior_status_verified_by_person_id").references(
      () => people.id,
    ),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedByPersonId: uuid("deleted_by_person_id").references(() => people.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("certifications_person_id_idx").on(table.personId),
    index("certifications_shop_person_idx").on(table.shopId, table.personId),
    index("certifications_junior_status_verifier_idx").on(table.juniorStatusVerifiedByPersonId),
    check(
      "certifications_junior_status_valid",
      sql`${table.juniorStatus} is null or ${table.juniorStatus} in ('junior', 'full')`,
    ),
    check(
      "certifications_junior_status_evidence",
      sql`(${table.juniorStatus} is null and ${table.juniorStatusVerifiedAt} is null and ${table.juniorStatusVerifiedByPersonId} is null) or (${table.juniorStatus} is not null and ${table.juniorStatusVerifiedAt} is not null and ${table.juniorStatusVerifiedByPersonId} is not null)`,
    ),
    index("certifications_processed_by_person_idx")
      .on(table.processedByPersonId)
      .where(sql`${table.processedByPersonId} is not null`),
    check(
      "certifications_processed_only_when_issued",
      sql`${table.processedWithAgencyAt} is null or ${table.issuedByShopAt} is not null`,
    ),
    uniqueIndex("certifications_shop_agency_identifier_unique")
      .on(table.shopId, table.agency, sql`lower(${table.identifier})`)
      .where(sql`${table.deletedAt} is null`),
    check(
      "certifications_identifier_present_unless_self_declared",
      sql`(${table.identifier} is not null and length(btrim(${table.identifier}, E' \\t\\n\\r\\f\\v')) > 0) or (${table.selfDeclaredAt} is not null and ${table.status} = 'pending') or (${table.issuedByShopAt} is not null)`,
    ),
  ],
);

export const premergeSpecialtyCertifications = pgTable(
  "specialty_certifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    agency: certificationAgency("agency").notNull(),
    specialty: diveSpecialty("specialty").notNull(),
    identifier: text("identifier"),
    status: certificationStatus("status").notNull().default("pending"),
    reviewNote: text("review_note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedByPersonId: uuid("reviewed_by_person_id").references(() => people.id),
    agencyCheckedAt: timestamp("agency_checked_at", { withTimezone: true }),
    importedAt: timestamp("imported_at", { withTimezone: true }),
    importedFromLabel: text("imported_from_label"),
    selfDeclaredAt: timestamp("self_declared_at", { withTimezone: true }),
    issuedByShopAt: timestamp("issued_by_shop_at", { withTimezone: true }),
    issuedFromTripId: uuid("issued_from_trip_id").references(() => trips.id, {
      onDelete: "set null",
    }),
    issuedByPersonId: uuid("issued_by_person_id").references(() => people.id),
    processedWithAgencyAt: timestamp("processed_with_agency_at", { withTimezone: true }),
    processedByPersonId: uuid("processed_by_person_id").references(() => people.id),
    listedFromCertificationId: uuid("listed_from_certification_id").references(
      () => premergeCertifications.id,
    ),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedByPersonId: uuid("deleted_by_person_id").references(() => people.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("specialty_certifications_shop_person_idx").on(table.shopId, table.personId),
    index("specialty_certifications_processed_by_person_idx")
      .on(table.processedByPersonId)
      .where(sql`${table.processedByPersonId} is not null`),
    check(
      "specialty_certifications_processed_only_when_issued",
      sql`${table.processedWithAgencyAt} is null or ${table.issuedByShopAt} is not null`,
    ),
    uniqueIndex("specialty_certifications_shop_agency_specialty_identifier_unique")
      .on(table.shopId, table.agency, table.specialty, sql`lower(${table.identifier})`)
      .where(sql`${table.deletedAt} is null`),
    check(
      "specialty_certifications_identifier_present_unless_unsighted",
      sql`(${table.identifier} is not null and length(btrim(${table.identifier}, E' \\t\\n\\r\\f\\v')) > 0) or (${table.selfDeclaredAt} is not null and ${table.status} = 'pending') or (${table.issuedByShopAt} is not null and ${table.status} = 'pending') or (${table.listedFromCertificationId} is not null and ${table.status} = 'pending')`,
    ),
  ],
);

export const premergeNitroxCertifications = pgTable(
  "nitrox_certifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    agency: certificationAgency("agency").notNull(),
    identifier: text("identifier"),
    status: certificationStatus("status").notNull().default("pending"),
    reviewNote: text("review_note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedByPersonId: uuid("reviewed_by_person_id").references(() => people.id),
    agencyCheckedAt: timestamp("agency_checked_at", { withTimezone: true }),
    importedAt: timestamp("imported_at", { withTimezone: true }),
    importedFromLabel: text("imported_from_label"),
    selfDeclaredAt: timestamp("self_declared_at", { withTimezone: true }),
    issuedByShopAt: timestamp("issued_by_shop_at", { withTimezone: true }),
    issuedFromTripId: uuid("issued_from_trip_id").references(() => trips.id, {
      onDelete: "set null",
    }),
    issuedByPersonId: uuid("issued_by_person_id").references(() => people.id),
    processedWithAgencyAt: timestamp("processed_with_agency_at", { withTimezone: true }),
    processedByPersonId: uuid("processed_by_person_id").references(() => people.id),
    listedFromCertificationId: uuid("listed_from_certification_id").references(
      () => premergeCertifications.id,
    ),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedByPersonId: uuid("deleted_by_person_id").references(() => people.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("nitrox_certifications_shop_person_idx").on(table.shopId, table.personId),
    index("nitrox_certifications_processed_by_person_idx")
      .on(table.processedByPersonId)
      .where(sql`${table.processedByPersonId} is not null`),
    check(
      "nitrox_certifications_processed_only_when_issued",
      sql`${table.processedWithAgencyAt} is null or ${table.issuedByShopAt} is not null`,
    ),
    uniqueIndex("nitrox_certifications_shop_agency_identifier_unique")
      .on(table.shopId, table.agency, sql`lower(${table.identifier})`)
      .where(sql`${table.deletedAt} is null`),
    check(
      "nitrox_certifications_identifier_present_unless_self_declared",
      sql`(${table.identifier} is not null and length(btrim(${table.identifier}, E' \\t\\n\\r\\f\\v')) > 0) or (${table.selfDeclaredAt} is not null and ${table.status} = 'pending') or (${table.issuedByShopAt} is not null and ${table.status} = 'pending') or (${table.listedFromCertificationId} is not null and ${table.status} = 'pending')`,
    ),
  ],
);

/** The tables above by name, for the guards that read the live database's catalog. */
export const PREMERGE_CARD_TABLES: readonly string[] = [
  "certifications",
  "specialty_certifications",
  "nitrox_certifications",
];
