import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { bookings } from "./bookings";
import { appNowTimestamp } from "./columns";
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
    createdAt: appNowTimestamp("created_at").notNull(),
    updatedAt: appNowTimestamp("updated_at").notNull(),
    filedAt: timestamp("filed_at", { withTimezone: true }),
    filedByPersonId: uuid("filed_by_person_id").references(() => people.id),
    /**
     * **A mistaken draft, discarded** (soft, like every delete): an owner took
     * it off the departure's Details tab and the Reports Safety tab. Only a
     * draft can be discarded, and the database says so below; a filed report
     * is amend-only. Who and when are on the departure's activity trail, which
     * carries no report content.
     */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /**
     * **A legal hold**, set and cleared by an owner: the seven-year retention
     * prune skips a held report until it is released (ADR
     * 20261012-incident-reports, amendment 2026-10-15). A held report cannot be
     * discarded.
     */
    legalHoldAt: timestamp("legal_hold_at", { withTimezone: true }),
    /**
     * **The missing-diver alert's lease** (H-142, decided 2026-10-16): stamped
     * when a pass took the report to tell the owners, so two passes never send
     * at once. It is a lease, not the proof of a send: a pass that crashed
     * leaves it stamped, and once it is older than the lease the next pass
     * takes the report again. A send that did not reach every owner gives it
     * back at once. `missing_alert_sent_at` is what says the owners were told
     * (`sendMissingDiverAlerts`). Null on every other kind, and on a report
     * neither filed nor raised (issue #2694).
     */
    missingAlertedAt: timestamp("missing_alerted_at", { withTimezone: true }),
    /**
     * When every active owner's email for a filed missing-diver report was
     * sent. Null until then; the report page says "Not reached yet" while it is.
     */
    missingAlertSentAt: timestamp("missing_alert_sent_at", { withTimezone: true }),
    /**
     * **Who the missing-diver alarm actually reached** (issue #2828): the
     * `people.id` of every owner whose alarm email was sent, appended at send
     * time by `sendMissingDiverAlerts`, once per person however many passes
     * it took. A partial send records the owners it reached; one whose email
     * failed is not here until a later pass reaches them.
     *
     * Found reads exactly this set for the all-clear
     * (`sendMissingDiverAllClear`), never the owner list as it stands then:
     * an owner who never saw the alarm is not cleared of it, and one who did
     * is never skipped. Staff ids only, never an address or a name; the
     * address is re-read from the person's login at send time.
     */
    missingAlertReachedPersonIds: jsonb("missing_alert_reached_person_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    /**
     * **Owners whose alarm email is being sent right now** (issue #2828,
     * adversarial review): written before the send, moved to
     * `missing_alert_reached_person_ids` once it went, and removed when the
     * provider said it failed. An id left here means nobody knows whether the
     * mail went (the process died mid-send), so the all-clear goes to them
     * too: a "found" note an owner may not need is the safe side of an owner
     * left believing a diver is missing.
     */
    missingAlertAttemptingPersonIds: jsonb("missing_alert_attempting_person_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    /**
     * **"Missing diver, alert owners now"** from the roll-call row (issue
     * #2694, decided by Aaron 2026-10-17): the one tap that tells the owners
     * at once, before the report is filled in. The alert then goes as for a
     * filed report (`sendMissingDiverAlerts`); the report stays a draft until
     * someone files it. A raised report is never discarded (CHECK below): the
     * owners were told about it.
     */
    missingAlertRaisedAt: timestamp("missing_alert_raised_at", { withTimezone: true }),
    missingAlertRaisedByPersonId: uuid("missing_alert_raised_by_person_id").references(
      () => people.id,
    ),
    /**
     * The raised report's affected person, as its `incident_report_people`
     * row (review 2026-10-17): the owners were told this person is missing,
     * so the row cannot be removed while this points at it (the foreign key
     * refuses), and a raised report always has one (CHECK below). Deleting the
     * report itself still takes its rows with it.
     */
    missingSubjectRowId: uuid("missing_subject_row_id").references(
      (): AnyPgColumn => incidentReportPeople.id,
    ),
    /**
     * **The diver was found** (issue #2694): recorded once, on a report whose
     * alert was raised or filed. It stops any alert not yet sent, and sends one
     * quiet all-clear by email to the owners. Never undone: a diver missing
     * again is a new disappearance, and a new report.
     */
    missingFoundAt: timestamp("missing_found_at", { withTimezone: true }),
    missingFoundByPersonId: uuid("missing_found_by_person_id").references(() => people.id),
    /**
     * When the all-clear was first tried: stamped by the first run, never
     * cleared. Not proof of a send; the report says partial while it is set
     * and `missing_all_clear_sent_at` is not.
     */
    missingAllClearClaimedAt: timestamp("missing_all_clear_claimed_at", { withTimezone: true }),
    /**
     * When the all-clear had gone to every owner it is owed to. Null while any
     * of them is still owed one (or none were sent).
     */
    missingAllClearSentAt: timestamp("missing_all_clear_sent_at", { withTimezone: true }),
    /**
     * **The owners whose all-clear went** (issue #2828): appended after each
     * sent email, so a retry (a second Found tap, the hourly pass) sends only
     * to the owners still owed one, and nobody gets two.
     */
    missingAllClearSentPersonIds: jsonb("missing_all_clear_sent_person_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    /**
     * The all-clear's lease: one run sends at a time. Given back when the run
     * ends, then the run looks once more for an owner who joined the set
     * while it held the lease. A run that died leaves it to run out.
     */
    missingAllClearLeasedAt: timestamp("missing_all_clear_leased_at", { withTimezone: true }),
    /** Who discarded the draft, named beside it on the departure log. */
    deletedByPersonId: uuid("deleted_by_person_id").references(() => people.id),
  },
  (table) => [
    index("incident_reports_shop_trip_idx")
      .on(table.shopId, table.tripId, table.createdAt)
      .where(sql`${table.deletedAt} is null`),
    // Today's "not filed" line reads the shop's live drafts, oldest first.
    index("incident_reports_live_drafts_idx")
      .on(table.shopId, table.createdAt)
      .where(sql`${table.status} = 'draft' and ${table.deletedAt} is null`),
    check(
      "incident_reports_deleted_by_whom",
      sql`(${table.deletedAt} is null) = (${table.deletedByPersonId} is null)`,
    ),
    index("incident_reports_shop_occurred_idx").on(table.shopId, table.occurredAt),
    // The two people FKs a raise and a find add (issue #2694), which erasure
    // and a merge check against every row.
    index("incident_reports_raised_by_idx")
      .on(table.missingAlertRaisedByPersonId)
      .where(sql`${table.missingAlertRaisedByPersonId} is not null`),
    index("incident_reports_found_by_idx")
      .on(table.missingFoundByPersonId)
      .where(sql`${table.missingFoundByPersonId} is not null`),
    check(
      "incident_reports_only_a_draft_is_discarded",
      sql`${table.deletedAt} is null or ${table.status} = 'draft'`,
    ),
    check(
      "incident_reports_raised_by_whom",
      sql`(${table.missingAlertRaisedAt} is null) = (${table.missingAlertRaisedByPersonId} is null)`,
    ),
    check(
      "incident_reports_found_by_whom",
      sql`(${table.missingFoundAt} is null) = (${table.missingFoundByPersonId} is null)`,
    ),
    // Only a missing-diver report raises an alert or records a find, and only
    // a report whose alert was raised or filed is found.
    check(
      "incident_reports_missing_only",
      sql`(${table.missingAlertRaisedAt} is null and ${table.missingFoundAt} is null)
        or ${table.kind} = 'missing_diver'`,
    ),
    check(
      "incident_reports_found_after_alert",
      sql`${table.missingFoundAt} is null or ${table.missingAlertRaisedAt} is not null
        or ${table.status} = 'filed'`,
    ),
    check(
      "incident_reports_raised_names_its_subject",
      sql`${table.missingAlertRaisedAt} is null or ${table.missingSubjectRowId} is not null`,
    ),
    check(
      "incident_reports_a_raised_report_is_kept",
      sql`${table.missingAlertRaisedAt} is null or ${table.deletedAt} is null`,
    ),
    check(
      "incident_reports_a_held_report_is_kept",
      sql`${table.legalHoldAt} is null or ${table.deletedAt} is null`,
    ),
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
    createdAt: appNowTimestamp("created_at").notNull(),
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
    createdAt: appNowTimestamp("created_at").notNull(),
  },
  (table) => [
    index("incident_report_addenda_report_idx").on(table.reportId, table.createdAt),
    check("incident_report_addenda_body_not_blank", sql`length(trim(${table.body})) > 0`),
    check("incident_report_addenda_body_length", sql`length(${table.body}) <= 5000`),
  ],
);
