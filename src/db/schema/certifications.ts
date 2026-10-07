import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
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

/** Evidence belongs to a person; requirements decide whether it is sufficient for a trip. */
export const certifications = pgTable(
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
    /**
     * The card number. Nullable **only** for a still-pending self-declaration
     * (`selfDeclaredAt`), which is a level and nothing else — see that column,
     * and the check constraint below that is the real rule. A placeholder
     * string was the alternative and is worse: "PENDING" in a card-number
     * column gets read as a card number eventually.
     */
    identifier: text("identifier"),
    /**
     * **The card number a diver typed about themselves**, kept deliberately
     * apart from `identifier` above — which is what the *shop* holds.
     *
     * The three public forms started asking for one on 2026-08-21 (issue #630)
     * so the verify queue has something to pre-check before the dive date. It
     * would have been cheaper to write it into `identifier` and the column is
     * nullable for exactly this row shape, but a `security-reviewer` pass found
     * two things wrong with that, and both are about `identifier` being a *key*:
     *
     * 1. **A number already on a live card raises 23505 inside the booking
     *    transaction** (`certifications_shop_agency_identifier_unique`), which
     *    fails the sale — and answers "is this number on file at this shop?" for
     *    anyone who types one and watches. Dropping the number on a collision
     *    only moved the tell: an unsighted claim *with* a number reads as
     *    `certification_pending` and one without reads as
     *    `certification_self_declared`, so the difference is rendered in words
     *    on the attacker's own readiness page.
     * 2. **It strands the real diver.** `certification_pending` withdraws the
     *    card-entry form (`CERT_ENTRY_CODES`) and says "your details are being
     *    verified" — so a stranger who knows a diver's name and email could
     *    take away that diver's only way to send their actual card.
     *
     * A column outside the unique index has neither problem: nothing collides,
     * nothing is dropped, and every unsighted claim reads the same however much
     * the diver typed. It is **never** evidence — `reviewCertification` still
     * demands a staffer type what is on the plastic, and what they type lands in
     * `identifier`, leaving this as the claim it was. A staffer comparing the
     * two is the whole point.
     *
     * The *agency* needs no such twin: it rides in `agency` (`other` when the
     * diver did not say), which is safe precisely because a claim's `identifier`
     * stays NULL, and a NULL is invisible to the unique index.
     */
    declaredIdentifier: text("declared_identifier"),
    /**
     * **There is no expiry column here, and its absence is the decision.**
     * Neither PADI nor SSI expires a recreational certification or mandates a
     * refresher, so the date this table carried until 2026-08-21 modelled a
     * rule that does not exist — and gated boarding on it
     * (ADR 20260821-a-card-does-not-expire, superseding
     * 20260723-certification-expiry-date-only). `waiver_records.expiresAt` is
     * a different thing entirely and stays: a waiver really does lapse.
     */
    status: certificationStatus("status").notNull().default("pending"),
    reviewNote: text("review_note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    /**
     * The live staff member who made the review that marked this card
     * certified. Null on records predating this accountable trail and on an
     * import that has not yet been reviewed by this shop.
     */
    reviewedByPersonId: uuid("reviewed_by_person_id").references(() => people.id),
    /**
     * Provenance for a card brought in by the contact importer
     * (ADR 20260724-import-verified-cards). A non-null `importedAt` is the
     * definitive "this card was migrated" marker — mirroring `waiverRecords`'
     * `signatureMethod: "imported"`. Imported cards land `verified` (the prior
     * system already checked them) but with `reviewedAt` still null, so the
     * pair `importedAt IS NOT NULL AND reviewedAt IS NULL` is exactly the
     * "verified, awaiting a staff confirm" set the diver UI surfaces. Confirming
     * stamps `reviewedAt` through the normal review path; the imported provenance
     * stays forever so an imported card is never mistaken for one this shop
     * carded on sight. `importedFromLabel` is the optional prior-shop/system name.
     */
    importedAt: timestamp("imported_at", { withTimezone: true }),
    importedFromLabel: text("imported_from_label"),
    /**
     * **A stranger typed this about themselves.** Set when a diver names their
     * own level on one of the three public forms that ask — the shop-wide
     * last-minute-deal list, a full trip's wait list, or the trip booking form
     * (added 2026-08-20) — nobody at the shop has seen a card, and the person
     * may not even be who the email says (FU-20260813, ADR
     * 20260814-self-declared-cards).
     *
     * Deliberately a *separate* provenance from `importedAt`, not a reuse of
     * it: an imported card came from a CSV the shop itself uploaded out of its
     * own prior system, which is a materially more trustworthy thing. Without
     * this column the feature would launder a self-declaration into something
     * that reads as shop-supplied.
     *
     * Three consequences hang off it, and all three are load-bearing:
     *
     * 1. `identifier` (and a real `agency`) may be absent while it is set —
     *    see the check constraint below. A self-declared row carries `other`
     *    as its agency because the form never asks; the staff UI renders the
     *    level alone rather than claiming an agency nobody stated.
     * 2. `decideTripAdmission` (src/lib/trip-admission.ts) **believes** a
     *    still-pending self-declared row at the sale, and `calculateReadiness`
     *    does not at the boat. That is the reverse of the original rule and it
     *    is deliberate (ADR 20260820-attested-at-booking-verified-at-boarding,
     *    H-27/H-29): a refused diver *can* type their way past the sale gate,
     *    which was accepted once it was clear that gate was never what keeps
     *    anyone out of the water. The sighting at the dock is.
     * 3. Verifying one is **not** the one-tap promote every other pending card
     *    gets: `reviewCertification` refuses without the agency and card number
     *    the staffer is looking at, which is the same act as capturing a card
     *    and is the point the diver's claim stops being the evidence.
     *
     * The stamp stays forever, like `importedAt` — where a row began is
     * history. "Still a claim" is `selfDeclaredAt IS NOT NULL AND status =
     * 'pending'`; once a staffer has sighted the card it is a sighted card
     * that happens to have started as a claim.
     */
    selfDeclaredAt: timestamp("self_declared_at", { withTimezone: true }),
    /**
     * **This shop's own instructor certified this diver, on this session.**
     * Set only by a per-student "Certified" tap on a course session's roster
     * (issue #717), never automatically — a session ending or a roll call
     * closing must never mint a card. A shop that taught the course, ran the
     * dives, and signed the paperwork is not in the same position as a shop
     * that has never met the diver, and until this existed it was: every
     * fresh graduate had their own card hand-typed back in as an unsighted
     * capture, exactly like a stranger's.
     *
     * Lands `verified` immediately, not `pending` — a third instance of the
     * pattern `importedAt` already established (`verified` on arrival,
     * trusted by *provenance* rather than by a staffer looking a number up
     * with the agency) and stronger than it: an import is trusted because of
     * a system nobody at this shop watched, a shop-issued card is trusted
     * because a specific, accountable instructor on this shop's own roster is
     * asserting personal knowledge that this specific person met the
     * standard, in a session this shop ran.
     *
     * `identifier` may therefore be absent while this is set — see the check
     * constraint below — because the card *number* comes from the agency's
     * own processing, routinely days behind the instructor's own sign-off.
     * Refusing the diver's next booking until a staffer later retypes a
     * number that arrives asynchronously would reproduce the exact gap this
     * column exists to close, just one layer down.
     *
     * The stamp stays forever, like `importedAt`/`selfDeclaredAt` — where a
     * row began is history.
     *
     * See ADR 20260824-shop-issued-certification-is-verified for the full
     * reasoning, alternatives considered, and consequences.
     */
    issuedByShopAt: timestamp("issued_by_shop_at", { withTimezone: true }),
    /**
     * The course session this card came from. Set only alongside
     * `issuedByShopAt`; null for every other provenance. A trip, not a
     * course: the level and the class of divers are the specific sailing
     * that earned the card, not the catalog entry a shop might run for years.
     * `onDelete: "set null"`: a *production* trip is never hard-deleted
     * (ADR 20260820-every-delete-is-soft), but the e2e/demo reset path
     * (`resetDemoSchedule`, src/db/seed.ts) genuinely does, and the
     * certification is not trip-scoped data — it is the diver's permanent
     * evidence and must survive its own session's row going away, just with
     * this one pointer cleared rather than the row erroring the reset or
     * being deleted along with it.
     */
    issuedFromTripId: uuid("issued_from_trip_id").references(() => trips.id, {
      onDelete: "set null",
    }),
    /**
     * The live staff member whose tap issued this card — mirrors
     * `reviewedByPersonId`'s accountable-name role for the sighted-review
     * path. Set only alongside `issuedByShopAt`.
     */
    issuedByPersonId: uuid("issued_by_person_id").references(() => people.id),
    /** Soft-archive: a deleted card keeps its row for safety history but drops
     * out of every readiness/roster read (ADR 20260719-crud-archive-semantics). */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /** Staff member who removed the card, when the removal was accountable. */
    deletedByPersonId: uuid("deleted_by_person_id").references(() => people.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("certifications_shop_person_idx").on(table.shopId, table.personId),
    // Partial on the live rows only, so archiving a card frees its number for
    // re-entry (e.g. a renewed card carrying the same identifier).
    // Case-insensitive so "ab1234" and "AB1234" can't create two live rows
    // for what is the same physical card (CR-009).
    //
    // A null identifier is invisible to a unique index (nulls never collide),
    // which is exactly right: two divers who each declared "Open Water" and no
    // number are not the same physical card.
    uniqueIndex("certifications_shop_agency_identifier_unique")
      .on(table.shopId, table.agency, sql`lower(${table.identifier})`)
      .where(sql`${table.deletedAt} is null`),
    // The rule the nullable `identifier` above is worth having: a card number
    // may be absent **only** while the row is a still-pending self-declaration.
    // It covers both ends at once — a staff or imported capture must still
    // carry a number, and a self-declared row cannot reach `verified` without
    // one, so the review gate is enforced by the database and not only by the
    // action that calls it.
    //
    // **Blank, not merely NULL.** It read `identifier is not null` until
    // 2026-08-15, and `''` satisfies that — so three comments and the ADR that
    // credited the database with "a numberless row cannot reach `verified`"
    // were true of NULL and enforced by the application for the empty string.
    // No writer could produce `''`, which is exactly why it was worth closing
    // rather than living with: the claim was load-bearing in four places and
    // only the application was holding it up.
    //
    // Deliberately *blank* and not `length(...) >= 3`, which the follow-up
    // proposed. Three characters is `isPlausibleCardNumber` — a **typo filter,
    // not proof**, whose documented virtue is being wrong in the permissive
    // direction because refusing a real card is the expensive failure. Written
    // into the schema it stops being a filter and becomes a structural
    // invariant that would refuse a genuine short member number at import time,
    // with no way past it. What the comments claimed was "a number", and this
    // is what "a number" means.
    //
    // Bare `btrim()` strips spaces and nothing else, so a lone tab satisfied it.
    // Unreachable from the app — `cardNumberSchema` trims in JS and
    // `isPlausibleCardNumber` demands a digit — but this is the *backstop*, and
    // a backstop that only holds when the layer above it already did is not one.
    //
    // **`is not null` stays, and dropping it was a real bug for an afternoon.**
    // A CHECK passes when its expression is TRUE *or NULL*, and
    // `length(btrim(NULL)) > 0` is NULL — so a predicate that led with the
    // length test alone evaluated to `NULL OR FALSE` = NULL on a numberless
    // `verified` row and **accepted** it, which is weaker than the constraint it
    // was tightening (caught by a `dive-domain-expert` pass, 2026-08-15). Both
    // conjuncts are load-bearing and neither is redundant: the first rules out
    // NULL, the second rules out blank.
    //
    // **A third exception, added for `issuedByShopAt` (issue #717,
    // ADR 20260824-shop-issued-certification-is-verified).** Unlike the
    // self-declared one, it is not conditioned on `status = 'pending'` — a
    // shop-issued row lands `verified` immediately, deliberately. A
    // self-declared row cannot reach `verified` without a number precisely
    // because nobody at the shop has seen anything; a shop-issued row is the
    // opposite case, an accountable instructor's own act of certifying, and
    // the missing number is the agency's own processing lag, not missing
    // evidence.
    check(
      "certifications_identifier_present_unless_self_declared",
      sql`(${table.identifier} is not null and length(btrim(${table.identifier}, E' \\t\\n\\r\\f\\v')) > 0) or (${table.selfDeclaredAt} is not null and ${table.status} = 'pending') or (${table.issuedByShopAt} is not null)`,
    ),
  ],
);

/**
 * A diver's specialty card (Deep, Wreck, Night, Drysuit). Structurally the
 * same capture→verify evidence as `certifications`, but carries a `specialty`
 * rather than a ladder `level`: a specialty is a yes/no gate, so it is checked
 * by kind, never by rank. Kept apart from the level ladder for the same reason
 * nitrox is (readiness.ts). Only a verified card can clear a specialty gate.
 */
export const specialtyCertifications = pgTable(
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
    /**
     * **Nullable only for a shop-issued card, and the check constraint below
     * is what says so.**
     *
     * It was NOT NULL until 2026-08-27, on the reasoning that "a specialty is a
     * yes/no gate on a materially riskier dive, so there is no version of one
     * that is only a claim with no number behind it". That reasoning is intact
     * and the constraint still enforces it for every path that existed then: a
     * staff capture, an import and a diver's own declaration all carry a
     * number, and a self-declared row still cannot reach `verified` without
     * one.
     *
     * The row this opens the door to is not a claim. A shop's own instructor
     * finishing their own Nitrox or Deep class has certified somebody, and the
     * agency number arrives days later — so the card is real and its number is
     * pending, which is a different thing from a stranger's typing. It lands
     * `pending` and clears nothing until a staffer confirms it against the
     * card, which is exactly the caution ADR 20260725-import-specialty-cards
     * asks for (issue #975).
     */
    identifier: text("identifier"),
    /** No expiry column, for the reason `certifications` states. */
    status: certificationStatus("status").notNull().default("pending"),
    reviewNote: text("review_note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    /** See certifications.reviewedByPersonId. */
    reviewedByPersonId: uuid("reviewed_by_person_id").references(() => people.id),
    /**
     * Import provenance, mirroring `certifications.importedAt` — an imported
     * specialty card lands `verified` and flagged
     * (ADR 20260725-import-specialty-cards). It diverges from a ladder card in
     * one deliberate way: the *gate* does not open on an imported card alone.
     * `specialtyBlocker` (src/lib/readiness.ts) holds a specialty requirement
     * until a staffer taps the one-tap confirm that stamps `reviewedAt`,
     * because a specialty is what authorizes a materially riskier dive (deep
     * gates depth past 18 m) and a spreadsheet cell is not a card sighting.
     * Same shape as nitrox's fill hold, expressed in the readiness layer
     * instead of SQL because that is where specialty gates are evaluated.
     */
    importedAt: timestamp("imported_at", { withTimezone: true }),
    importedFromLabel: text("imported_from_label"),
    /**
     * **The diver typed this about themselves**, mirroring
     * `certifications.selfDeclaredAt` and `nitroxCertifications.selfDeclaredAt`.
     *
     * This table went without one until 2026-08-20 because nothing a diver
     * could reach could write here — a fact `src/db/self-declared-cards.ts`
     * stated in two places. The readiness page now offers a specialty entry
     * form, and the column is what makes that safe: without it a row a diver
     * typed is byte-for-byte a staff transcription of a card somebody held, so
     * `reviewSpecialtyCertification`'s ordinary one-tap confirm would promote
     * an invented number to `verified` — the state that clears a deep gate past
     * 18 m. With it, that tap asks for the agency and number off the card in
     * the staffer's hand, exactly as the level and nitrox cards already do
     * (`security-reviewer`, 2026-08-20).
     *
     * `identifier` stays NOT NULL, unlike its two siblings: a specialty is a
     * yes/no gate on a materially riskier dive, so there is no version of one
     * that is only a claim with no number behind it. The diver-facing form
     * requires the number.
     */
    selfDeclaredAt: timestamp("self_declared_at", { withTimezone: true }),
    /**
     * **This shop's own instructor certified this diver, on this session.**
     *
     * Mirrors `certifications.issuedByShopAt` (issue #717, ADR
     * 20260824-shop-issued-certification-is-verified) with **one deliberate
     * difference: the row lands `pending`, not `verified`** (issue #975, ADR
     * 20260827-shop-issued-specialty-cards-are-attested).
     *
     * A level card's shop issuance clears its own gate on the instructor's tap,
     * because the instructor is the evidence. A specialty or nitrox card does
     * not, because this table's own precedent is stricter and was set for a
     * reason: even an **imported** row — which the codebase trusts enough to
     * clear a level gate on arrival — is deliberately held back from clearing
     * *this* gate until a staffer confirms it by hand ("a spreadsheet cell is
     * not a card sighting", ADR 20260725-import-specialty-cards). A wrong
     * nitrox fill is the highest-consequence failure in this app.
     *
     * So what this stamp buys is that the record **exists** — the diver who
     * finished a Nitrox class on Saturday is no longer invisible to their own
     * shop on Sunday — while the gate still waits for somebody to look at a
     * card. The confirm asks for the agency and the number, exactly as an
     * unsighted self-declaration's does.
     */
    issuedByShopAt: timestamp("issued_by_shop_at", { withTimezone: true }),
    /**
     * The course session this card came from, set only alongside
     * `issuedByShopAt`. `onDelete: "set null"` for the same reason as its
     * level-card twin: a certification is the diver's permanent evidence and
     * must outlive the sailing that earned it.
     */
    issuedFromTripId: uuid("issued_from_trip_id").references(() => trips.id, {
      onDelete: "set null",
    }),
    /** The live staff member whose tap issued this card. Set only alongside `issuedByShopAt`. */
    issuedByPersonId: uuid("issued_by_person_id").references(() => people.id),
    /** Soft-archive, mirroring `certifications.deletedAt`. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /** Staff member who removed the card, when the removal was accountable. */
    deletedByPersonId: uuid("deleted_by_person_id").references(() => people.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("specialty_certifications_shop_person_idx").on(table.shopId, table.personId),
    // Case-insensitive like certifications_shop_agency_identifier_unique (CR-009),
    // but keyed on the **specialty** as well — an agency number identifies the
    // *diver*, not the card (docs/product/glossary.md, "C-card": agency, level,
    // cert/diver number). A PADI diver's Deep and Wreck cards carry the same PADI
    // number, so keying without the specialty let a shop hold only one specialty
    // card per diver: the second was refused by `createSpecialtyCertification` and
    // silently skipped by the importer, and the remedy the copy offered ("give
    // each card its own number") does not exist at any agency
    // (`dive-domain-expert` review, ADR 20260725-import-specialty-cards).
    uniqueIndex("specialty_certifications_shop_agency_specialty_identifier_unique")
      .on(table.shopId, table.agency, table.specialty, sql`lower(${table.identifier})`)
      .where(sql`${table.deletedAt} is null`),
    // **The rule the nullable `identifier` above is worth having**, in the
    // database rather than only in the action that writes it.
    //
    // A specialty card number may be absent on exactly one path: a still-
    // `pending` card this shop's own instructor issued. Every other row — a
    // staff capture, an import, a diver's own declaration — carries a number,
    // and a shop-issued row **cannot reach `verified` without one**, which is
    // the whole difference from the level card's twin constraint (that one
    // exempts `issuedByShopAt` unconditionally, because a level card lands
    // verified on the instructor's tap; this one does not, because a specialty
    // gate waits for somebody to look at the card).
    //
    // The self-declared exemption is unchanged and is conditioned on `pending`
    // for the same reason.
    //
    // `is not null` leads, and is not redundant with the length test: a CHECK
    // passes when its expression is TRUE *or NULL*, and `length(btrim(NULL))`
    // is NULL — so a predicate starting with the length test alone would
    // evaluate to NULL and **accept** a numberless verified row, which is the
    // afternoon-long bug the level card's own comment records.
    check(
      "specialty_certifications_identifier_present_unless_unsighted",
      sql`(${table.identifier} is not null and length(btrim(${table.identifier}, E' \\t\\n\\r\\f\\v')) > 0) or (${table.selfDeclaredAt} is not null and ${table.status} = 'pending') or (${table.issuedByShopAt} is not null and ${table.status} = 'pending')`,
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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

/**
 * A nitrox (EANx) specialty card. Modeled separately from `certifications`
 * because that table is the recreational ladder (its `level` enum feeds the
 * readiness rank map); a specialty is a distinct yes/no gate, not a ladder
 * rung. Same capture→verify workflow: evidence starts pending and only a
 * verified card lets a diver request enriched air on a booking.
 */
export const nitroxCertifications = pgTable(
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
    /** Nullable only for a still-pending self-declaration — see
     * `selfDeclaredAt` below and `certifications.identifier`. */
    identifier: text("identifier"),
    status: certificationStatus("status").notNull().default("pending"),
    reviewNote: text("review_note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    /** See certifications.reviewedByPersonId. */
    reviewedByPersonId: uuid("reviewed_by_person_id").references(() => people.id),
    /**
     * Import provenance, mirroring `certifications.importedAt` — an imported
     * nitrox card lands `verified` (flagged) awaiting a staff confirm
     * (ADR 20260724-import-verified-cards). Enriched-air fill authorization
     * reads `verified`, so a confirmed-or-not imported nitrox card can clear a
     * fill; the imported marker keeps it distinguishable and expiry/fill-time
     * re-checks still apply.
     */
    importedAt: timestamp("imported_at", { withTimezone: true }),
    importedFromLabel: text("imported_from_label"),
    /**
     * Self-declared provenance, mirroring `certifications.selfDeclaredAt` and
     * carrying every one of its consequences — read that column's comment. The
     * public join forms ask "nitrox certified?" as a checkbox, so what lands
     * here is a yes with no agency and no number behind it, and a fill is
     * still authorized only by a `verified` card.
     */
    selfDeclaredAt: timestamp("self_declared_at", { withTimezone: true }),
    /**
     * **This shop's own instructor certified this diver, on this session** —
     * the nitrox twin of `specialtyCertifications.issuedByShopAt`, carrying
     * every one of its consequences. Read that column's comment.
     *
     * The row lands `pending`, so it authorizes **no fill**. Enriched-air fill
     * authorization reads `verified` and nothing else, and that is the line
     * this column must never cross: a wrong nitrox fill is the
     * highest-consequence failure in this app, and an instructor's own tap is
     * not somebody looking at a card. What the stamp buys is that the diver who
     * finished Saturday's Nitrox class is no longer invisible to their own shop
     * on Sunday morning (issue #975, ADR
     * 20260827-shop-issued-specialty-cards-are-attested).
     */
    issuedByShopAt: timestamp("issued_by_shop_at", { withTimezone: true }),
    /**
     * The course session this card came from, set only alongside
     * `issuedByShopAt`. `onDelete: "set null"` so the diver's evidence outlives
     * the sailing that earned it.
     */
    issuedFromTripId: uuid("issued_from_trip_id").references(() => trips.id, {
      onDelete: "set null",
    }),
    /** The live staff member whose tap issued this card. Set only alongside `issuedByShopAt`. */
    issuedByPersonId: uuid("issued_by_person_id").references(() => people.id),
    /** Soft-archive, mirroring `certifications.deletedAt`. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /** Staff member who removed the card, when the removal was accountable. */
    deletedByPersonId: uuid("deleted_by_person_id").references(() => people.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("nitrox_certifications_shop_person_idx").on(table.shopId, table.personId),
    // Case-insensitive, mirroring certifications_shop_agency_identifier_unique (CR-009).
    //
    // **Some agencies issue no standalone nitrox card.** RAID and GUE bundle
    // EANx into the level card itself — RAID Open Water 20 and GUE Rec 1 both
    // certify enriched air — so there is no separate number to type here, and
    // the honest entry is the *level* card's own number (docs/product/
    // glossary.md, "Nitrox card"). That works by construction: the index is
    // keyed per agency and per table, so the same number living on a
    // `certifications` row and this one is not a collision. It is written down
    // because it looks like a mistake to whoever does it, and the two things a
    // staffer does instead — refuse a fill to a properly trained diver, or hand
    // the tank over off-system — are both worse.
    uniqueIndex("nitrox_certifications_shop_agency_identifier_unique")
      .on(table.shopId, table.agency, sql`lower(${table.identifier})`)
      .where(sql`${table.deletedAt} is null`),
    // Same rule as `certifications_identifier_present_unless_self_declared`,
    // both conjuncts included — read that one for why neither is redundant and
    // why leading with the length test alone silently accepts a NULL.
    check(
      "nitrox_certifications_identifier_present_unless_self_declared",
      sql`(${table.identifier} is not null and length(btrim(${table.identifier}, E' \\t\\n\\r\\f\\v')) > 0) or (${table.selfDeclaredAt} is not null and ${table.status} = 'pending') or (${table.issuedByShopAt} is not null and ${table.status} = 'pending')`,
    ),
  ],
);

export type Certification = typeof certifications.$inferSelect;

export type SpecialtyCertification = typeof specialtyCertifications.$inferSelect;

export type NitroxCertification = typeof nitroxCertifications.$inferSelect;
