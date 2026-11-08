import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  date,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { appNowTimestamp } from "./columns";
import {
  certificationAgency,
  certificationLevel,
  certificationStatus,
  diveSpecialty,
  people,
  shops,
} from "./core";
import { trips } from "./trips";

/**
 * A diver's evidence: certification, specialty and nitrox cards, and prior
 * visits.
 */

/**
 * **What a card is for.** `level` is a rung on the recreational ladder (its
 * `level` column feeds the readiness rank map); `specialty` is a yes/no gate on
 * a riskier dive (Deep, Wreck, Night, Drysuit), checked by kind and never by
 * rank; `nitrox` is the enriched-air card the fill gate reads. They were three
 * tables until issue #2722 and are one ledger now, because every column but the
 * rung and the specialty was the same and merge, erasure, export and the
 * readiness reader each had to remember all three.
 *
 * **Every read of `cards` names its kind** unless it means every card (merge,
 * erasure, export). A level gate that read a nitrox row would admit a diver on
 * a card that says nothing about their rung, so a reader by id filters `kind`
 * too: an id from a form is not proof of which kind of card it names.
 */
export const cardKind = pgEnum("card_kind", ["level", "specialty", "nitrox"]);

/**
 * **How a card was archived** (issue #3701): `staff` when a staffer deleted it
 * from the diver's record by hand, `system` when DiveDay archived it in favor of
 * other evidence (an agency check taken back, a card an agency listing
 * replaced, a self-declared claim a sighted card replaced). Only a `staff`
 * delete is undoable, and only for a short window (`cardUndoRefusal`,
 * `src/features/card-undo/rules.ts`); a null on an archived row is read as `system`, so a
 * writer that forgets to say fails closed.
 */
export const cardDeletionKind = pgEnum("card_deletion_kind", ["staff", "system"]);

/**
 * **A diver's card, of any kind** (issue #2722): evidence belongs to a person;
 * requirements decide whether it is sufficient for a trip.
 *
 * `kind` decides which of `level` and `specialty` is set (`cards_kind_shape`),
 * and a few columns belong to one kind only (each says which). The rest is the
 * capture→verify evidence all three kinds share: a card starts `pending`, and
 * only a `verified` one clears a gate, with the provenance stamps below saying
 * where the row began.
 */
export const cards = pgTable(
  "cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    kind: cardKind("kind").notNull(),
    agency: certificationAgency("agency").notNull(),
    /** The rung. Set exactly when `kind = 'level'`. */
    level: certificationLevel("level"),
    /** The specialty. Set exactly when `kind = 'specialty'`. */
    specialty: diveSpecialty("specialty"),
    /**
     * The card number. Nullable **only** where the identifier check below says
     * so, and that check is the real rule:
     *
     * - a still-pending self-declaration (`selfDeclaredAt`), of any kind;
     * - a card this shop issued (`issuedByShopAt`): a level card at any status,
     *   because the instructor is the evidence and the number is the agency's
     *   processing lag; a specialty or nitrox card only while `pending`, because
     *   that gate waits for somebody to look at a card;
     * - a specialty or nitrox card an agency check listed
     *   (`listedFromCertificationId`) at an agency that numbers each card, whose
     *   page showed none, while `pending`. Its confirm is the card sighting.
     *
     * A placeholder string was the alternative and is worse: "PENDING" in a
     * card-number column gets read as a card number eventually.
     *
     * **Some agencies issue no standalone nitrox card.** RAID and GUE bundle
     * EANx into the level card itself, so the honest nitrox entry is the level
     * card's own number (docs/product/glossary.md, "Nitrox card"). The unique
     * indexes below are keyed per kind, so the same number on a level row and a
     * nitrox row is not a collision.
     */
    identifier: text("identifier"),
    /**
     * **The card number a diver typed about themselves**, kept deliberately
     * apart from `identifier` above — which is what the *shop* holds. Level
     * cards only (`cards_declared_identifier_level_only`).
     *
     * The three public forms started asking for one on 2026-08-21 (issue #630)
     * so the verify queue has something to pre-check before the dive date. It
     * would have been cheaper to write it into `identifier`, but a
     * `security-reviewer` pass found two things wrong with that, and both are
     * about `identifier` being a *key*:
     *
     * 1. **A number already on a live card raises 23505 inside the booking
     *    transaction** (`cards_level_shop_agency_identifier_unique`), which
     *    fails the sale — and answers "is this number on file at this shop?" for
     *    anyone who types one and watches.
     * 2. **It strands the real diver.** `certification_pending` withdraws the
     *    card-entry form (`CERT_ENTRY_CODES`), so a stranger who knows a diver's
     *    name and email could take away that diver's only way to send their
     *    actual card.
     *
     * A column outside the unique index has neither problem. It is **never**
     * evidence — `reviewCertification` still demands a staffer type what is on
     * the plastic, and what they type lands in `identifier`.
     */
    declaredIdentifier: text("declared_identifier"),
    /**
     * **There is no expiry column here, and its absence is the decision.**
     * Neither PADI nor SSI expires a recreational certification or mandates a
     * refresher (ADR 20260821-a-card-does-not-expire). `waiver_records.expiresAt`
     * is a different thing entirely and stays: a waiver really does lapse.
     */
    status: certificationStatus("status").notNull().default("pending"),
    reviewNote: text("review_note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    /**
     * The live staff member who made the review that marked this card
     * certified. Null on a card nobody at this shop has reviewed.
     */
    reviewedByPersonId: uuid("reviewed_by_person_id").references(() => people.id),
    /**
     * **The agency's own page said so** (H-20261008-cert-check-extension, ADR
     * 20261008-cert-check-extension). Set when the review that certified this
     * card was a check the DiveDay browser extension ran on the agency's lookup
     * page from the staffer's own browser, and the page named this diver with
     * this card. `reviewNote` then holds the agency's words that matched, and
     * `reviewedByPersonId` the staffer whose browser ran the check. Undo clears
     * it with the rest of the review.
     */
    agencyCheckedAt: timestamp("agency_checked_at", { withTimezone: true }),
    /**
     * Provenance for a card brought in by the contact importer
     * (ADR 20260724-import-verified-cards). An imported card lands `verified`
     * with `reviewedAt` still null, so `importedAt IS NOT NULL AND reviewedAt IS
     * NULL` is exactly the "verified, awaiting a staff confirm" set. A level
     * card clears boarding on arrival; a **specialty** card does not, because
     * `specialtyBlocker` (src/lib/readiness.ts) holds a specialty gate until the
     * confirm stamps `reviewedAt` — a spreadsheet cell is not a card sighting
     * (ADR 20260725-import-specialty-cards). The stamp stays forever.
     */
    importedAt: timestamp("imported_at", { withTimezone: true }),
    importedFromLabel: text("imported_from_label"),
    /**
     * **A stranger typed this about themselves** on a public form, nobody at the
     * shop has seen a card, and the person may not even be who the email says
     * (ADR 20260814-self-declared-cards). Deliberately separate from
     * `importedAt`: a CSV the shop uploaded out of its own prior system is a
     * materially more trustworthy thing.
     *
     * `decideTripAdmission` (src/lib/trip-admission.ts) **believes** a
     * still-pending self-declared level card at the sale, and
     * `calculateReadiness` does not at the boat (ADR
     * 20260820-attested-at-booking-verified-at-boarding). Verifying one is
     * **not** the one-tap promote: the review asks for the agency and number off
     * the card in the staffer's hand. "Still a claim" is `selfDeclaredAt IS NOT
     * NULL AND status = 'pending'`; the stamp stays forever.
     */
    selfDeclaredAt: timestamp("self_declared_at", { withTimezone: true }),
    /**
     * **This shop's own instructor certified this diver, on this session**: a
     * per-student "Certified" tap on a course session's roster (issue #717),
     * never automatic.
     *
     * A **level** card lands `verified`: an accountable instructor on this
     * shop's roster is the evidence (ADR
     * 20260824-shop-issued-certification-is-verified). A **specialty or nitrox**
     * card lands `pending` and clears nothing until a staffer confirms it
     * against the card (issue #975, ADR
     * 20260827-shop-issued-specialty-cards-are-attested): a wrong nitrox fill is
     * the highest-consequence failure in this app, and an instructor's tap is
     * not somebody looking at a card. The stamp stays forever.
     */
    issuedByShopAt: timestamp("issued_by_shop_at", { withTimezone: true }),
    /**
     * The course session this card came from. Set only alongside
     * `issuedByShopAt`. `onDelete: "set null"`: the e2e/demo reset path
     * (`resetDemoSchedule`) hard-deletes trips, and the card is the diver's
     * permanent evidence, so it outlives the sailing that earned it.
     */
    issuedFromTripId: uuid("issued_from_trip_id").references(() => trips.id, {
      onDelete: "set null",
    }),
    /** The live staff member whose tap issued this card. Set only alongside `issuedByShopAt`. */
    issuedByPersonId: uuid("issued_by_person_id").references(() => people.id),
    /**
     * **When the shop told the agency about this card** (fifth-loop ideas,
     * item 46): the instructor's "Processed with PADI" after Certify. It
     * records the shop's own act and issues nothing. Set only on a card the
     * shop issued.
     */
    processedWithAgencyAt: timestamp("processed_with_agency_at", { withTimezone: true }),
    /** The staff member who ticked it; set only alongside `processedWithAgencyAt`. */
    processedByPersonId: uuid("processed_by_person_id").references(() => people.id),
    /**
     * **The agency check that listed this card** (layer 3 of ADR
     * 20261008-cert-check-extension): the level card whose match found this
     * specialty or nitrox card on the same agency page, set only when a staffer
     * added it from that offer. Never set on a level card
     * (`cards_listed_from_not_level`). The row's "Listed on PADI's page." reads
     * it, the level check's Undo archives the still-pending rows it spawned, and
     * a row it marks with no number is confirmed through the card sighting,
     * never the one tap.
     */
    listedFromCertificationId: uuid("listed_from_certification_id").references(
      (): AnyPgColumn => cards.id,
    ),
    /**
     * Explicit staff sighting of the card wording; null is unknown, not a full
     * card. Level cards only (`cards_junior_status_level_only`).
     */
    juniorStatus: text("junior_status").$type<"junior" | "full">(),
    juniorStatusVerifiedAt: timestamp("junior_status_verified_at", { withTimezone: true }),
    juniorStatusVerifiedByPersonId: uuid("junior_status_verified_by_person_id").references(
      () => people.id,
    ),
    /** Soft-archive: a deleted card keeps its row for safety history but drops
     * out of every readiness/roster read (ADR 20260719-crud-archive-semantics). */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /** Staff member who removed the card, when the removal was accountable. */
    deletedByPersonId: uuid("deleted_by_person_id").references(() => people.id),
    /** Whether a staffer deleted it by hand or DiveDay archived it ({@link cardDeletionKind}). */
    deletionKind: cardDeletionKind("deletion_kind"),
    createdAt: appNowTimestamp("created_at").notNull(),
  },
  (table) => [
    // Leads on the person column so deleting a person (a demo shop's cascade,
    // `discardUnusedBuyer`) probes this foreign key by index, not by scanning
    // every shop's rows; a (shop_id, …) composite cannot serve that probe.
    // `people-fk-indexes.test.ts` holds the list (fourth review, row 31).
    index("cards_person_id_idx").on(table.personId),
    index("cards_shop_person_kind_idx").on(table.shopId, table.personId, table.kind),
    index("cards_junior_status_verifier_idx").on(table.juniorStatusVerifiedByPersonId),
    // Partial: almost every card is never processed here, and a merge or a
    // demo cascade probes this foreign key (`people-fk-indexes.test.ts`).
    index("cards_processed_by_person_idx")
      .on(table.processedByPersonId)
      .where(sql`${table.processedByPersonId} is not null`),
    // The rung and the specialty belong to one kind each, and exactly one.
    check(
      "cards_kind_shape",
      sql`(${table.kind} = 'level' and ${table.level} is not null and ${table.specialty} is null) or (${table.kind} = 'specialty' and ${table.specialty} is not null and ${table.level} is null) or (${table.kind} = 'nitrox' and ${table.level} is null and ${table.specialty} is null)`,
    ),
    check(
      "cards_declared_identifier_level_only",
      sql`${table.declaredIdentifier} is null or ${table.kind} = 'level'`,
    ),
    check(
      "cards_listed_from_not_level",
      sql`${table.listedFromCertificationId} is null or ${table.kind} <> 'level'`,
    ),
    check(
      "cards_junior_status_level_only",
      sql`${table.juniorStatus} is null or ${table.kind} = 'level'`,
    ),
    check(
      "cards_junior_status_valid",
      sql`${table.juniorStatus} is null or ${table.juniorStatus} in ('junior', 'full')`,
    ),
    check(
      "cards_junior_status_evidence",
      sql`(${table.juniorStatus} is null and ${table.juniorStatusVerifiedAt} is null and ${table.juniorStatusVerifiedByPersonId} is null) or (${table.juniorStatus} is not null and ${table.juniorStatusVerifiedAt} is not null and ${table.juniorStatusVerifiedByPersonId} is not null)`,
    ),
    check(
      "cards_processed_only_when_issued",
      sql`${table.processedWithAgencyAt} is null or ${table.issuedByShopAt} is not null`,
    ),
    // Partial on the live rows only, so archiving a card frees its number for
    // re-entry. Case-insensitive so "ab1234" and "AB1234" can't create two live
    // rows for what is the same physical card (CR-009). A null identifier is
    // invisible to a unique index, which is right: two divers who each declared
    // "Open Water" and no number are not the same physical card.
    //
    // One index per kind, because the key differs. A specialty is keyed on the
    // specialty as well: an agency number identifies the *diver*, not the card
    // (docs/product/glossary.md, "C-card"), so a PADI diver's Deep and Wreck
    // cards carry the same number (`dive-domain-expert` review, ADR
    // 20260725-import-specialty-cards). A nitrox card at RAID or GUE carries
    // the level card's number, which the per-kind key allows.
    uniqueIndex("cards_level_shop_agency_identifier_unique")
      .on(table.shopId, table.agency, sql`lower(${table.identifier})`)
      .where(sql`${table.deletedAt} is null and ${table.kind} = 'level'`),
    uniqueIndex("cards_specialty_shop_agency_specialty_identifier_unique")
      .on(table.shopId, table.agency, table.specialty, sql`lower(${table.identifier})`)
      .where(sql`${table.deletedAt} is null and ${table.kind} = 'specialty'`),
    uniqueIndex("cards_nitrox_shop_agency_identifier_unique")
      .on(table.shopId, table.agency, sql`lower(${table.identifier})`)
      .where(sql`${table.deletedAt} is null and ${table.kind} = 'nitrox'`),
    // **The rule the nullable `identifier` is worth having**, in the database
    // rather than only in the action that writes it. See that column for the
    // three exemptions; every other row carries a number.
    //
    // **Blank, not merely NULL**, and deliberately not `length >= 3`
    // (`isPlausibleCardNumber` is a typo filter, not proof; written into the
    // schema it would refuse a genuine short member number at import). Bare
    // `btrim()` strips spaces only, so the whitespace class is spelled out.
    //
    // **`is not null` leads, and is load-bearing.** A CHECK passes when its
    // expression is TRUE *or NULL*, and `length(btrim(NULL)) > 0` is NULL, so a
    // predicate leading with the length test alone accepts a numberless
    // verified row (caught by a `dive-domain-expert` pass, 2026-08-15).
    check(
      "cards_identifier_present_unless_unsighted",
      sql`(${table.identifier} is not null and length(btrim(${table.identifier}, E' \\t\\n\\r\\f\\v')) > 0) or (${table.selfDeclaredAt} is not null and ${table.status} = 'pending') or (${table.issuedByShopAt} is not null and (${table.kind} = 'level' or ${table.status} = 'pending')) or (${table.listedFromCertificationId} is not null and ${table.kind} <> 'level' and ${table.status} = 'pending')`,
    ),
  ],
);

/** Every staff sighting/correction is retained with the card until erasure. */
export const certificationJuniorReviews = pgTable(
  "certification_junior_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    certificationId: uuid("certification_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    recordedByPersonId: uuid("recorded_by_person_id")
      .notNull()
      .references(() => people.id),
    juniorStatus: text("junior_status").$type<"junior" | "full">().notNull(),
    recordedAt: appNowTimestamp("recorded_at").notNull(),
  },
  (table) => [
    index("certification_junior_reviews_person_idx").on(table.personId),
    index("certification_junior_reviews_recorder_idx").on(table.recordedByPersonId),
    index("certification_junior_reviews_card_idx").on(
      table.shopId,
      table.certificationId,
      table.recordedAt,
    ),
    check(
      "certification_junior_reviews_status_valid",
      sql`${table.juniorStatus} in ('junior', 'full')`,
    ),
  ],
);

/**
 * A visit the diver made **before DiveDay** — one row per booking the shop's
 * prior system recorded, brought across by the contact importer
 * (ADR 20260725-import-prior-visits).
 *
 * This table is deliberately inert. It is the shop's own history, kept as
 * history: nothing here is read by readiness, capacity, roll call, trip prep,
 * or owner reporting, and nothing here opens a gate. It exists so a diver's
 * profile can say "you have dived with this shop eleven times since 2019"
 * instead of starting every migrated regular at zero.
 *
 * Three shapes of dishonesty are ruled out by construction rather than by
 * convention:
 *
 *   - **It is not a trip and not a booking.** Reconstructing `trips`/`bookings`
 *     rows would require inventing capacity, planned dives, and a roll call
 *     that never happened here — a fabricated safety document. A prior visit
 *     points at no trip, so there is nothing to fabricate and nothing for the
 *     dock to act on.
 *   - **A booking is not a dive.** `statusLabel` carries the prior system's own
 *     word for the row ("Completed", "Cancelled", "No-show") verbatim, because
 *     an orders export contains all three and counting them alike would invent
 *     dives the diver never made. Never normalized to a DiveDay enum: the
 *     vocabularies are not the same and mapping one onto the other is a guess.
 *   - **The money is a label, not an amount.** `amountLabel` is the raw text the
 *     file held ("$180.00", "160,00 €") — never parsed to minor units, never
 *     given a currency column, never summed. Storing text is what makes
 *     "display-only" structural: there is no number here for a future reporting
 *     query to pick up by accident, and no locale to misread (`1.234,56`).
 */
export const priorVisits = pgTable(
  "prior_visits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    /**
     * Date-only and shop-local, like certification expiry (CR-009). A prior
     * system's export gives a calendar day, not an instant with a zone, and
     * inventing a departure time would be inventing a trip.
     */
    visitedOn: date("visited_on", { mode: "string" }).notNull(),
    /** What the prior system called it ("Two-tank Molasses Reef"); free text. */
    title: text("title"),
    /** The source's own status word, verbatim and un-mapped. See the note above. */
    statusLabel: text("status_label"),
    /** Display-only money as text. Never parsed, never summed. See the note above. */
    amountLabel: text("amount_label"),
    /** The prior shop/system this came from, for the profile's provenance line. */
    sourceLabel: text("source_label"),
    /** The prior system's own booking/order id, when the export carried one. */
    sourceReference: text("source_reference"),
    /**
     * What re-running the same import twice keys on. Derived in
     * `src/lib/import.ts` (`priorVisitDedupeKey`): the source's booking/order id
     * when the file has one, otherwise the row's own date/title/amount. A second
     * import of the same file must not double a diver's history, and an orders
     * export is exactly the file an owner re-runs as their roster grows.
     */
    dedupeKey: text("dedupe_key").notNull(),
    /** Always set — every row here arrived by import, never by hand. */
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull(),
    createdAt: appNowTimestamp("created_at").notNull(),
  },
  (table) => [
    index("prior_visits_shop_person_idx").on(table.shopId, table.personId, table.visitedOn),
    uniqueIndex("prior_visits_shop_person_dedupe_unique").on(
      table.shopId,
      table.personId,
      table.dedupeKey,
    ),
  ],
);

export type Card = typeof cards.$inferSelect;
export type CardKind = Card["kind"];

/** A level card: the row `cards_kind_shape` guarantees when `kind = 'level'`. */
export type Certification = Card & {
  kind: "level";
  level: NonNullable<Card["level"]>;
  specialty: null;
};

/** A specialty card: the row `cards_kind_shape` guarantees when `kind = 'specialty'`. */
export type SpecialtyCertification = Card & {
  kind: "specialty";
  level: null;
  specialty: NonNullable<Card["specialty"]>;
};

/** A nitrox card: the row `cards_kind_shape` guarantees when `kind = 'nitrox'`. */
export type NitroxCertification = Card & { kind: "nitrox"; level: null; specialty: null };
