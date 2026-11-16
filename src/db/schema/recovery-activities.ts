import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  RecoveryActivityEventCode,
  RecoveryActivitySnapshot,
} from "@/lib/recovery-activities";
import { appNowTimestamp } from "./columns";
import { people, shops } from "./core";
import { tripBlowoutDivers, tripBlowouts } from "./dive-day";

/** A complimentary, non-diving activity, arranged after a departure is cancelled. */
export const recoveryActivities = pgTable(
  "recovery_activities",
  {
    id: uuid("id").primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    blowoutId: uuid("blowout_id")
      .notNull()
      .references(() => tripBlowouts.id),
    title: text("title").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    location: text("location").notNull(),
    capacity: integer("capacity").notNull(),
    coordinatorPersonId: uuid("coordinator_person_id")
      .notNull()
      .references(() => people.id),
    createdByPersonId: uuid("created_by_person_id")
      .notNull()
      .references(() => people.id),
    arrangementsConfirmedByPersonId: uuid("arrangements_confirmed_by_person_id")
      .notNull()
      .references(() => people.id),
    arrangementsConfirmedAt: appNowTimestamp("arrangements_confirmed_at").notNull(),
    status: text("status").$type<"scheduled" | "cancelled">().notNull().default("scheduled"),
    revision: integer("revision").notNull().default(0),
    createdAt: appNowTimestamp("created_at").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("recovery_activities_shop_id_id_unique").on(t.shopId, t.id),
    index("recovery_activities_blowout_idx").on(t.shopId, t.blowoutId),
    index("recovery_activities_coordinator_idx").on(t.coordinatorPersonId, t.shopId),
    index("recovery_activities_created_by_idx").on(t.createdByPersonId, t.shopId),
    index("recovery_activities_arrangements_by_idx").on(
      t.arrangementsConfirmedByPersonId,
      t.shopId,
    ),
    foreignKey({
      columns: [t.shopId, t.blowoutId],
      foreignColumns: [tripBlowouts.shopId, tripBlowouts.id],
      name: "recovery_activities_scoped_blowout_fk",
    }),
    ...[t.coordinatorPersonId, t.createdByPersonId, t.arrangementsConfirmedByPersonId].map(
      (column, i) =>
        foreignKey({
          columns: [t.shopId, column],
          foreignColumns: [people.shopId, people.id],
          name: `recovery_activities_scoped_person_${i}_fk`,
        }),
    ),
    check("recovery_activities_capacity", sql`${t.capacity} between 1 and 500`),
    check("recovery_activities_times", sql`${t.endsAt} > ${t.startsAt}`),
    check("recovery_activities_status", sql`${t.status} in ('scheduled', 'cancelled')`),
    check("recovery_activities_revision", sql`${t.revision} >= 0`),
  ],
);

/** Prepared evidence only: this table never means sent, accepted, or reserved. */
export const recoveryActivityOffers = pgTable(
  "recovery_activity_offers",
  {
    id: uuid("id").primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    activityId: uuid("activity_id").notNull(),
    blowoutDiverId: uuid("blowout_diver_id").notNull(),
    actorPersonId: uuid("actor_person_id")
      .notNull()
      .references(() => people.id),
    snapshot: jsonb("snapshot").$type<RecoveryActivitySnapshot>().notNull(),
    preparedAt: appNowTimestamp("prepared_at").notNull(),
  },
  (t) => [
    index("recovery_activity_offers_actor_idx").on(t.actorPersonId, t.shopId),
    uniqueIndex("recovery_activity_offers_activity_diver_unique").on(
      t.shopId,
      t.activityId,
      t.blowoutDiverId,
    ),
    foreignKey({
      columns: [t.shopId, t.activityId],
      foreignColumns: [recoveryActivities.shopId, recoveryActivities.id],
      name: "recovery_activity_offers_scoped_activity_fk",
    }),
    foreignKey({
      columns: [t.shopId, t.blowoutDiverId],
      foreignColumns: [tripBlowoutDivers.shopId, tripBlowoutDivers.id],
      name: "recovery_activity_offers_scoped_diver_fk",
    }),
    foreignKey({
      columns: [t.shopId, t.actorPersonId],
      foreignColumns: [people.shopId, people.id],
      name: "recovery_activity_offers_scoped_actor_fk",
    }),
  ],
);

/** Current allocation; source identity is verified by staff, never by a public inquiry. */
export const recoveryActivityParticipants = pgTable(
  "recovery_activity_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    activityId: uuid("activity_id").notNull(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    blowoutDiverId: uuid("blowout_diver_id").notNull(),
    status: text("status").$type<"confirmed" | "cancelled">().notNull(),
    revision: integer("revision").notNull().default(0),
    confirmedAt: appNowTimestamp("confirmed_at").notNull(),
    confirmedByPersonId: uuid("confirmed_by_person_id")
      .notNull()
      .references(() => people.id),
  },
  (t) => [
    index("recovery_activity_participants_person_idx").on(t.personId, t.shopId),
    index("recovery_activity_participants_confirmed_by_idx").on(t.confirmedByPersonId, t.shopId),
    uniqueIndex("recovery_activity_participants_shop_id_id_unique").on(t.shopId, t.id),
    uniqueIndex("recovery_activity_participants_person_unique")
      .on(t.shopId, t.activityId, t.personId)
      .where(sql`${t.status} = 'confirmed'`),
    uniqueIndex("recovery_activity_participants_source_unique").on(
      t.shopId,
      t.activityId,
      t.blowoutDiverId,
    ),
    foreignKey({
      columns: [t.shopId, t.activityId],
      foreignColumns: [recoveryActivities.shopId, recoveryActivities.id],
      name: "recovery_activity_participants_scoped_activity_fk",
    }),
    foreignKey({
      columns: [t.shopId, t.blowoutDiverId],
      foreignColumns: [tripBlowoutDivers.shopId, tripBlowoutDivers.id],
      name: "recovery_activity_participants_scoped_diver_fk",
    }),
    foreignKey({
      columns: [t.shopId, t.personId],
      foreignColumns: [people.shopId, people.id],
      name: "recovery_activity_participants_scoped_person_fk",
    }),
    foreignKey({
      columns: [t.shopId, t.confirmedByPersonId],
      foreignColumns: [people.shopId, people.id],
      name: "recovery_activity_participants_scoped_actor_fk",
    }),
    check("recovery_activity_participants_status", sql`${t.status} in ('confirmed', 'cancelled')`),
  ],
);

/** Immutable operation trail; transition data contains codes/counts/revisions, never contact details. */
export const recoveryActivityEvents = pgTable(
  "recovery_activity_events",
  {
    id: uuid("id").primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    activityId: uuid("activity_id").notNull(),
    participantId: uuid("participant_id"),
    actorPersonId: uuid("actor_person_id")
      .notNull()
      .references(() => people.id),
    requestHash: text("request_hash").notNull(),
    resultRevision: integer("result_revision").notNull(),
    code: text("code").$type<RecoveryActivityEventCode>().notNull(),
    transition: jsonb("transition")
      .$type<{
        expectedRevision: number;
        capacity?: number;
        blowoutDiverId?: string;
        priorPersonId?: string;
        canonicalPersonId?: string;
      }>()
      .notNull(),
    recordedAt: appNowTimestamp("recorded_at").notNull(),
  },
  (t) => [
    index("recovery_activity_events_actor_idx").on(t.actorPersonId, t.shopId),
    foreignKey({
      columns: [t.shopId, t.activityId],
      foreignColumns: [recoveryActivities.shopId, recoveryActivities.id],
      name: "recovery_activity_events_scoped_activity_fk",
    }),
    foreignKey({
      columns: [t.shopId, t.participantId],
      foreignColumns: [recoveryActivityParticipants.shopId, recoveryActivityParticipants.id],
      name: "recovery_activity_events_scoped_participant_fk",
    }),
    foreignKey({
      columns: [t.shopId, t.actorPersonId],
      foreignColumns: [people.shopId, people.id],
      name: "recovery_activity_events_scoped_actor_fk",
    }),
    check(
      "recovery_activity_events_code",
      sql`${t.code} in ('identity_merged', 'created', 'offer_prepared', 'place_confirmed', 'place_cancelled', 'activity_cancelled', 'capacity_changed')`,
    ),
  ],
);
