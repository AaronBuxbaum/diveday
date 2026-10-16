import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { bookings } from "./bookings";
import { people, shops } from "./core";
import { diveSites } from "./dive-sites";
import { trips } from "./trips";

/**
 * **The shop's own account of something that went wrong on a departure** (ADR
 * 20261012-incident-reports): the report, the people in it, and the dated
 * addenda that follow it once it is filed.
 *
 * Personal and medical data end to end. Kept seven years from the incident
 * (`RETENTION_DAYS.incident_reports`), carried in the shop export, and reached
 * by `anonymizeDiver`, which redacts a diver's identity and keeps the report.
 * Nothing on the dock reads these tables: a report is a record, never a gate.
 */

export const incidentReportStatus = pgEnum("incident_report_status", ["draft", "filed"]);

/**
 * Who took the person over after the incident. `none`: nobody — they stayed
 * with the crew. `diver`: the person themselves, released on scene. A null
 * column is a handover nobody has answered yet.
 */
export const incidentHandoverKind = pgEnum("incident_handover_kind", [
  "none",
  "ems",
  "hospital",
  "chamber",
  "diver",
  "other",
]);

/**
 * **What kind of incident it was** (batch 6, item 7; ADR
 * 20261012-incident-reports, amendment 2026-10-14). A missing diver is its own
 * kind, not an injury: it is the one an insurer and a coastguard ask about
 * first. A fatality is its own kind too; `injury` reads "Injury or illness".
 * Null on a draft nobody has answered yet; filing needs it.
 */
export const incidentKind = pgEnum("incident_kind", [
  "injury",
  "near_miss",
  "equipment",
  "missing_diver",
  "fatality",
  "other",
]);

/**
 * **How serious it was**, in the crew's own judgement on the day — three
 * words, never a clinical scale. Null until answered; filing needs it.
 */
export const incidentSeverity = pgEnum("incident_severity", ["minor", "moderate", "serious"]);

/** How a person was part of the incident. */
export const incidentInvolvement = pgEnum("incident_involvement", [
  "affected",
  "witness",
  "responder",
]);

export const incidentReports = pgTable(
  "incident_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id),
    status: incidentReportStatus("status").notNull().default("draft"),
    /** When it happened. Entered and shown in the shop's zone; stored as an instant. */
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    /** One of the shop's sites, or `location_text` for anywhere else. */
    diveSiteId: uuid("dive_site_id").references(() => diveSites.id),
    locationText: text("location_text"),
    whatHappened: text("what_happened"),
    kind: incidentKind("kind"),
    severity: incidentSeverity("severity"),
    /**
     * The three yes/no answers stay **null until answered**: an insurer reads
     * "no oxygen" and "nobody said" as different facts, so neither is assumed.
     */
    firstAidGiven: boolean("first_aid_given"),
    oxygenGiven: boolean("oxygen_given"),
    oxygenMinutes: integer("oxygen_minutes"),
    emergencyServicesCalled: boolean("emergency_services_called"),
    handoverKind: incidentHandoverKind("handover_kind"),
    handoverDetail: text("handover_detail"),
    handedOverAt: timestamp("handed_over_at", { withTimezone: true }),
    followUp: text("follow_up"),
    createdByPersonId: uuid("created_by_person_id")
      .notNull()
      .references(() => people.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    filedAt: timestamp("filed_at", { withTimezone: true }),
    filedByPersonId: uuid("filed_by_person_id").references(() => people.id),
    /**
     * **A draft its writer, an owner or a manager deleted** (ADR
     * 20261016-incident-drafts): a double start, a test, a report about
     * something that turned out to be nothing. Soft (ADR
     * 20260820-every-delete-is-soft): the row stays, the departure log lists
     * it as a deleted draft, and the departure's trail says who. A filed
     * report is never deleted; the database holds that too.
     */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedByPersonId: uuid("deleted_by_person_id").references(() => people.id),
  },
  (table) => [
    index("incident_reports_shop_trip_idx").on(table.shopId, table.tripId, table.createdAt),
    // Today's "not filed" line reads the shop's live drafts, oldest first.
    index("incident_reports_live_drafts_idx")
      .on(table.shopId, table.createdAt)
      .where(sql`${table.status} = 'draft' and ${table.deletedAt} is null`),
    check(
      "incident_reports_deleted_draft_only",
      sql`${table.deletedAt} is null or ${table.status} = 'draft'`,
    ),
    check(
      "incident_reports_deleted_by_whom",
      sql`(${table.deletedAt} is null) = (${table.deletedByPersonId} is null)`,
    ),
    index("incident_reports_shop_occurred_idx").on(table.shopId, table.occurredAt),
    check(
      "incident_reports_oxygen_minutes",
      sql`${table.oxygenMinutes} is null or (${table.oxygenGiven} is true and ${table.oxygenMinutes} between 1 and 1440)`,
    ),
    // Filing is refused without these, and the database says so too: a filed
    // report always answers when, where, what, and the three yes/no questions,
    // and who took over care once emergency services or oxygen were involved.
    check(
      "incident_reports_filed_complete",
      sql`${table.status} = 'draft' or (
        ${table.filedAt} is not null and ${table.filedByPersonId} is not null
        and ${table.occurredAt} is not null and ${table.whatHappened} is not null
        and ${table.firstAidGiven} is not null and ${table.oxygenGiven} is not null
        and ${table.emergencyServicesCalled} is not null
        and (${table.diveSiteId} is not null or ${table.locationText} is not null)
        and (${table.handoverKind} is not null
          or (${table.emergencyServicesCalled} is false and ${table.oxygenGiven} is false))
      )`,
    ),
  ],
);

/**
 * A person in the incident: a diver by their **booking** on this departure, a
 * staffer by their **person** row, or somebody else by name. Exactly one of the
 * three. Names of divers and staff are read live, so an erasure of the person
 * reaches every report they are in without touching this row.
 */
export const incidentReportPeople = pgTable(
  "incident_report_people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    reportId: uuid("report_id")
      .notNull()
      .references(() => incidentReports.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id").references(() => bookings.id),
    personId: uuid("person_id").references(() => people.id),
    outsiderName: text("outsider_name"),
    involvement: incidentInvolvement("involvement").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("incident_report_people_report_idx").on(table.reportId, table.createdAt),
    index("incident_report_people_booking_idx").on(table.bookingId),
    // The people FK, which erasure and a merge check against every row.
    index("incident_report_people_person_idx")
      .on(table.personId)
      .where(sql`${table.personId} is not null`),
    check(
      "incident_report_people_one_subject",
      sql`num_nonnulls(${table.bookingId}, ${table.personId}, ${table.outsiderName}) = 1`,
    ),
    check(
      "incident_report_people_outsider_name_length",
      sql`${table.outsiderName} is null or length(${table.outsiderName}) <= 200`,
    ),
  ],
);

/** Append-only: what was learned after the report was filed, dated and attributed. */
export const incidentReportAddenda = pgTable(
  "incident_report_addenda",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    reportId: uuid("report_id")
      .notNull()
      .references(() => incidentReports.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    authorPersonId: uuid("author_person_id")
      .notNull()
      .references(() => people.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("incident_report_addenda_report_idx").on(table.reportId, table.createdAt),
    check("incident_report_addenda_body_not_blank", sql`length(trim(${table.body})) > 0`),
    check("incident_report_addenda_body_length", sql`length(${table.body}) <= 5000`),
  ],
);
