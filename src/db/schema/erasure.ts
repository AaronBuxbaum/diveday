import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { people, shops } from "./core";

/**
 * The erasure path's own bookkeeping: media deletion attempts and processor
 * erasure obligations.
 */

/**
 * `waiver_document` (a scanned paper release or medical form brought in by the
 * importer) is the blob kind diver erasure owes a delete for
 * (ADR 20260802-diver-data-erasure) — the row's URL column is nulled locally
 * and the object itself is retired through this same ledger rather than a
 * second, parallel mechanism. `recap_photo` joins it for a diver who shared
 * photos of their own.
 *
 * **`certification_card` is unreachable** and kept only because Postgres has no
 * `ALTER TYPE … DROP VALUE`: removing it means recreating the type that
 * `media_deletions.kind` depends on, which is a materially riskier migration
 * than the dead enum member costs. A card has carried no photograph since ADR
 * 20260811-retire-the-digital-card dropped `card_image_url`, so nothing can
 * queue one; its labels stay so a pre-release row still renders a word.
 */
export const mediaDeletionKind = pgEnum("media_deletion_kind", [
  "course_photo",
  "recap_photo",
  "certification_card",
  "waiver_document",
  "dive_site_photo",
  "shop_logo",
  "arrival_photo",
  "shop_hero",
  /**
   * A receipt document re-stored from a prior system's export
   * (`imported_payment_history.receipt_document_url`). Queued only by diver
   * erasure: a receipt almost always renders the buyer's name, so an erased
   * diver whose receipt blob stays hosted is erased in the database and not in
   * the bucket (issue #1607).
   */
  "payment_receipt",
]);

export const mediaDeletionStatus = pgEnum("media_deletion_status", [
  "pending",
  "succeeded",
  "failed",
]);

/**
 * One row per "this blob object should no longer exist" decision — a recap
 * photo's row deleted by staff moderation, or a course hero/gallery photo
 * superseded on save. Mirrors `paymentOperationIntents` (CR-005): the local
 * removal (the row gone, the URL dropped from `imageUrls`) is never blocked on
 * storage, so this table is the durable record of "we still owe a delete"
 * that survives a crash between the local change and the provider call
 * succeeding. A `pending` row that never resolved (the process died before
 * the delete call returned) and a `failed` row (the delete call itself
 * failed) both need the same retry — `attempts`/`lastError` exist so an owner
 * sees why, not just that (CR-012).
 */
export const mediaDeletionAttempts = pgTable(
  "media_deletion_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    kind: mediaDeletionKind("kind").notNull(),
    url: text("url").notNull(),
    status: mediaDeletionStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [index("media_deletion_attempts_shop_status_idx").on(table.shopId, table.status)],
);

/**
 * What an erasure obligation is owed *against*, which also decides who can
 * discharge it (ADR 20260803-processor-erasure-obligations):
 *
 * - `stripe_customer` — a `cus_…` object DiveDay deletes itself through
 *   `DELETE /v1/customers/{id}` on the shop's connected account. Retryable and
 *   self-discharging: the row exists so a failed or never-attempted delete is
 *   durable and gets tried again, exactly like `mediaDeletionAttempts`.
 * - `stripe_invoice_snapshot` — an `in_…` finalized invoice. Stripe copies
 *   `customer_name`/`customer_email` onto the invoice when it is finalized, and
 *   deleting the customer does **not** rewrite that copy; Stripe handles
 *   Invoice/PaymentIntent/Charge separately in its own data-deletion flow. No
 *   API call clears it, so this kind is a genuinely manual step and is
 *   discharged only by a human attesting they filed that request.
 * - `stripe_checkout_session_snapshot` — a `cs_…` Checkout Session. It carries
 *   `customer_email` exactly as DiveDay handed it over and `customer_details`
 *   once the diver completes it, and Stripe exposes no delete for a session:
 *   `POST /v1/checkout/sessions/{id}/expire` closes it but rewrites neither
 *   field. Same shape as the invoice snapshot, therefore, and discharged the
 *   same way — a human attesting to the data-deletion request (issue #1621).
 */
export const processorErasureTarget = pgEnum("processor_erasure_target", [
  "stripe_customer",
  "stripe_invoice_snapshot",
  "stripe_checkout_session_snapshot",
]);

export const processorErasureStatus = pgEnum("processor_erasure_status", ["owed", "discharged"]);

/**
 * One row per "a processor still holds this erased diver's identity" — the
 * durable counterpart to `mediaDeletionAttempts` for records DiveDay does not
 * store itself (ADR 20260803-processor-erasure-obligations).
 *
 * Raised by `anonymizeDiver` (src/db/anonymize.ts) from all three tables that
 * can hold a Stripe object standing for a person — `orders`, `tips` and
 * `booking_checkouts`. Orders contribute a `stripe_customer` row per distinct
 * `stripe_customer_id` and a `stripe_invoice_snapshot` row per distinct
 * `stripe_invoice_id`; the other two contribute a
 * `stripe_checkout_session_snapshot` row per session and a `stripe_customer`
 * row per session that actually minted one. Orders alone was the gap issue
 * #1621 closed: a diver who only ever tipped, or who paid through a checkout
 * that never became an order, left nothing in this ledger at all.
 *
 * The table does two jobs, and the `target` above says which applies:
 *
 *   1. **A retry ledger for work DiveDay does perform.** The customer delete is
 *      attempted *after* the erasure transaction commits — never inside it, and
 *      never as a condition of it. A Stripe outage, a revoked Connect token or
 *      a dead network must not roll back an erasure the diver asked for, so the
 *      row commits first and the attempt happens after; `attempts`/`lastError`
 *      are why a failure is visible rather than merely retried forever.
 *   2. **A record of what no API can reach.** The invoice-snapshot and
 *      checkout-session-snapshot rows are not retryable at all. They exist so
 *      nothing in the product implies erasure finished when a copy of the name
 *      and email is still sitting on a finalized invoice or a Checkout Session.
 *
 * `external_id` is a `cus_…`/`in_…`/`cs_…` handle, not personal data: it is the
 * pointer, and the row deliberately keeps no name, address or amount.
 */
export const processorErasureObligations = pgTable(
  "processor_erasure_obligations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    /**
     * The erasure that raised this. The row it points at is already anonymized,
     * so this is provenance ("which erasure still owes work"), never a way back
     * to who the diver was.
     */
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    target: processorErasureTarget("target").notNull(),
    externalId: text("external_id").notNull(),
    /**
     * The connected account the object lives on, snapshotted from the source
     * row's own `stripe_account_id` rather than re-derived from the shop at retry
     * time — the same discipline `refundOrder` uses (src/db/orders.ts). A shop
     * that disconnects and reconnects gets a *different* account id, and a
     * delete aimed at the current one would 404 forever against an object that
     * is still sitting on the old one.
     */
    stripeAccountId: text("stripe_account_id").notNull(),
    status: processorErasureStatus("status").notNull().default("owed"),
    /** Delete attempts made so far. Always 0 for a target no API can discharge. */
    attempts: integer("attempts").notNull().default(0),
    /** Why the last attempt failed, so an owner sees *why* and not merely *that*. */
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    dischargedAt: timestamp("discharged_at", { withTimezone: true }),
    /**
     * Who attested the processor-side work was done. Null while still owed —
     * and also null on a `stripe_customer` row discharged by a successful API
     * delete, which is DiveDay's own act rather than anyone's attestation.
     */
    dischargedByPersonId: uuid("discharged_by_person_id").references(() => people.id),
  },
  (table) => [
    // One obligation per processor record per shop, ever. A second erasure that
    // reaches the same Stripe customer (two people sharing one customer object
    // — itself a data problem, but possible) is folded into the existing row
    // rather than raising a duplicate: the work owed is the same single delete,
    // and `personId` names whichever erasure got there first.
    uniqueIndex("processor_erasure_obligations_shop_target_external_unique").on(
      table.shopId,
      table.target,
      table.externalId,
    ),
    // The reports-page panel's read: this shop's still-owed obligations.
    index("processor_erasure_obligations_shop_status_idx").on(table.shopId, table.status),
    check(
      "processor_erasure_obligations_discharged_consistent",
      sql`(${table.status} = 'discharged') = (${table.dischargedAt} is not null)`,
    ),
  ],
);

export type MediaDeletionAttempt = typeof mediaDeletionAttempts.$inferSelect;

export type ProcessorErasureObligation = typeof processorErasureObligations.$inferSelect;

export type MediaDeletionKind = (typeof mediaDeletionKind.enumValues)[number];

export type ProcessorErasureTarget = (typeof processorErasureTarget.enumValues)[number];
