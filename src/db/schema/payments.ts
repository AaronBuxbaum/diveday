import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { bookings, tripLastMinutePromos } from "./bookings";
import { people, shops } from "./core";
import { trips } from "./trips";

/**
 * Money: promo codes and dive packages, booking payments and their events,
 * Stripe accounts, orders and line items, checkouts, tips, payment intents and
 * imported payment history.
 */

/** What a shop-wide promo code may be spent on; `all` is both. */
export const shopPromoScope = pgEnum("shop_promo_scope", ["all", "trips", "courses"]);

/**
 * Which departures a dive package covers. `fun_dives` excludes course sessions,
 * which is the ordinary shape — a shop sells cheap dives to a certified diver,
 * not cheap instruction (ADR 20260822-a-package-is-entitlements-not-money).
 */
export const divePackageScope = pgEnum("dive_package_scope", ["all", "fun_dives"]);

export type DivePackageScope = (typeof divePackageScope.enumValues)[number];

export const shopPromoStatus = pgEnum("shop_promo_status", [
  "pending",
  "active",
  "disabled",
  "failed",
]);

/**
 * A shop-wide, staff-authored discount code — the general promotion model
 * `tripLastMinutePromos` deliberately was not (docs ADR
 * 20260727-last-minute-fill-promos left it "one narrow producer of Stripe
 * promotion codes, not the thing it replaces"). Same Stripe-native mechanism:
 * DiveDay mints a Coupon + PromotionCode on the shop's own connected account
 * and hands the resolved `promo_...` id to Checkout explicitly, so Stripe
 * independently enforces expiry and redemption caps while the local row keeps
 * the scope/window the shop actually configured. Inserted `pending` before
 * either Stripe call, exactly like a last-minute blast, so a crash mid-create
 * leaves evidence rather than nothing (docs ADR 20260729-shop-promo-codes).
 */
export const shopPromoCodes = pgTable(
  "shop_promo_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    /** Normalized upper-case (`normalizePromoCode`, src/lib/promo-codes.ts) — what a diver types. */
    code: text("code").notNull(),
    /** Staff's own note about what this code is for; never shown to a diver. */
    description: text("description"),
    discountPercent: integer("discount_percent").notNull(),
    scope: shopPromoScope("scope").notNull().default("all"),
    status: shopPromoStatus("status").notNull().default("pending"),
    /** Null means "live now"; null `expiresAt` means the shop set no end date. */
    startsAt: timestamp("starts_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** Null is unlimited. Stripe enforces the cap at checkout; this is the shop's stated intent. */
    maxRedemptions: integer("max_redemptions"),
    stripeCouponId: text("stripe_coupon_id"),
    stripePromotionCodeId: text("stripe_promotion_code_id"),
    createdByPersonId: uuid("created_by_person_id").references(() => people.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("shop_promo_codes_shop_created_idx").on(table.shopId, table.createdAt),
    uniqueIndex("shop_promo_codes_shop_code_unique").on(table.shopId, table.code),
    check("shop_promo_codes_discount_range", sql`${table.discountPercent} between 1 and 100`),
    check(
      "shop_promo_codes_max_redemptions_positive",
      sql`${table.maxRedemptions} is null or ${table.maxRedemptions} > 0`,
    ),
    check(
      "shop_promo_codes_window",
      sql`${table.startsAt} is null or ${table.expiresAt} is null or ${table.startsAt} < ${table.expiresAt}`,
    ),
  ],
);

/**
 * One paid redemption of a shop-wide code — the "redemption history" half of a
 * real promotion model. Written inside `markCheckoutPaidBySessionId`'s
 * transaction and keyed unique on the checkout, so a replayed or duplicated
 * Stripe webhook can never inflate a code's usage count. Stripe remains the
 * authority on whether a redemption was *allowed*; this is DiveDay's own audit
 * trail for reporting and for a later cancellation/refund conversation.
 */
export const shopPromoRedemptions = pgTable(
  "shop_promo_redemptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    promoCodeId: uuid("promo_code_id")
      .notNull()
      .references(() => shopPromoCodes.id),
    checkoutId: uuid("checkout_id")
      .notNull()
      .references(() => bookingCheckouts.id),
    /**
     * What the checkout this code was spent on actually settled for, as Stripe
     * reported it (`booking_checkouts.settled_total_cents`) — the money the
     * shop received with this code applied. Recording it is not DiveDay
     * re-deriving a discount it does not own: the number is copied verbatim
     * from Stripe's own `amount_total`, which is why this column may hold it.
     * Falls back to the checkout's quoted (pre-discount) total when no settled
     * figure exists — a historical row, or a completion Stripe reported no
     * total for.
     */
    amountChargedCents: integer("amount_charged_cents").notNull(),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("shop_promo_redemptions_checkout_unique").on(table.checkoutId),
    index("shop_promo_redemptions_promo_idx").on(table.promoCodeId, table.redeemedAt),
  ],
);

/**
 * **What a shop sells when it sells "ten dives".** The definition, not a
 * purchase — one row per product on the shop's price list
 * (ADR 20260822-a-package-is-entitlements-not-money).
 *
 * The unit is a **dive**, never an amount. A diver who buys ten dives for $900
 * and takes a $180 wreck charter has used one dive, not $90 of $900, and every
 * shop that sells packages sells them precisely so the diver stops thinking
 * about the per-dive price. A stored-value model reintroduces it, most sharply
 * on the expensive departure — which is why gift cards (stored value, and their
 * unclaimed-balance rules) are a different product and remain unscheduled.
 */
export const divePackages = pgTable(
  "dive_packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    /** What the diver sees on the price list — "Ten-dive package". */
    name: text("name").notNull(),
    /** How many dives it buys. Unlimited is deliberately out of scope. */
    diveCount: integer("dive_count").notNull(),
    /** In the shop's own currency's minor units, like every other price here. */
    priceCents: integer("price_cents").notNull(),
    /**
     * Which departures it covers. `all` is every departure; `fun_dives` excludes
     * course sessions, which is the ordinary shape — a shop sells cheap dives to
     * a certified diver, not cheap instruction.
     *
     * Resolved against the departure at booking time, which is a read: what the
     * shop sold cannot depend on when the diver books.
     */
    scope: divePackageScope("scope").notNull().default("fun_dives"),
    /** Inclusive calendar end date; null means the package never lapses. */
    validUntil: date("valid_until"),
    /**
     * Soft-deleted like everything a user can delete
     * (ADR 20260820-every-delete-is-soft). Deleting a package the shop no longer
     * sells must never invalidate the dives someone already bought — the
     * entitlements below reference this row and outlive it.
     */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdByPersonId: uuid("created_by_person_id").references(() => people.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("dive_packages_shop_idx")
      .on(table.shopId, table.createdAt)
      .where(sql`${table.deletedAt} is null`),
    check("dive_packages_dive_count_positive", sql`${table.diveCount} > 0`),
    check("dive_packages_price_positive", sql`${table.priceCents} > 0`),
  ],
);

/**
 * **One dive a diver has already paid for and not yet taken.** N rows per
 * purchase, one consumed per covered booking
 * (ADR 20260822-a-package-is-entitlements-not-money).
 *
 * Rows rather than a counter, for two facts a counter cannot hold: *which*
 * booking consumed *which* dive, and when. Without the first, a cancellation
 * cannot hand back precisely what it took; without the second, consumption-based
 * revenue recognition is not reportable at all — so a counter would decide the
 * ADR's open accounting question by accident, in the direction that is harder to
 * reverse.
 *
 * An entitlement is **consumed, never spent**: returning one on a cancellation
 * undoes a link rather than crediting an amount, so it cannot round, drift, or
 * give back more than it took.
 */
export const divePackageEntitlements = pgTable(
  "dive_package_entitlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    packageId: uuid("package_id")
      .notNull()
      .references(() => divePackages.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    /**
     * The order the diver paid on. Every entitlement from one purchase shares
     * it, which is what makes "refund the whole package" a question that can be
     * asked of the data.
     */
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    /**
     * The booking this dive was used on, and `consumedAt` beside it. Null means
     * unused. A two-tank departure consumes two rows, one per tank.
     */
    bookingId: uuid("booking_id").references(() => bookings.id),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    /**
     * When this dive stops being usable, resolved from the package's fixed
     * `validUntil` date at purchase. Null never lapses. Stamped per entitlement
     * rather than read back through the package, so a later edit to the product
     * cannot retroactively shorten a package somebody already bought.
     */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The hot read: "how many dives does this diver have left?"
    index("dive_package_entitlements_person_idx")
      .on(table.shopId, table.personId)
      .where(sql`${table.consumedAt} is null`),
    index("dive_package_entitlements_order_idx").on(table.orderId),
    // A booking may consume one row per tank; the booking transaction is the
    // concurrency boundary, so this remains a lookup index rather than a
    // uniqueness constraint.
    index("dive_package_entitlements_booking_idx").on(table.bookingId),
    // Consumed and unconsumed are the only two shapes; a row carrying one half
    // of the pair is a bug that would read as "used by nobody" or "used at no
    // time", and both are worse than a refusal.
    check(
      "dive_package_entitlements_consumption_paired",
      sql`(${table.bookingId} is null) = (${table.consumedAt} is null)`,
    ),
  ],
);

/**
 * A booking's current payment state. deposit_paid, paid, and waived clear the
 * "ready to board" payment gate; unpaid and refunded do not (readiness.ts).
 */
export const paymentStatus = pgEnum("payment_status", [
  "unpaid",
  "deposit_paid",
  "paid",
  "waived",
  /**
   * Money came back but not all of it — the shop still holds some (issue
   * #699). `amount_cents` is what it still holds, on the same "what is
   * collected right now" basis a full refund already used when it wrote zero.
   *
   * **This clears the boarding gate.** It is in `PAYMENT_CLEARED`
   * (`src/lib/readiness.ts`) beside `deposit_paid` for the same reason: part
   * of the fare is real money, and a shop that hands back half after weather
   * cuts a boat short must not thereby make that diver unable to board.
   */
  "partly_refunded",
  "refunded",
]);

/** One current payment row per booking. Amounts are minor units (cents). */
export const bookingPayments = pgTable(
  "booking_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    status: paymentStatus("status").notNull().default("unpaid"),
    amountCents: integer("amount_cents"),
    currency: text("currency").notNull(),
    /** Provider that took the payment, e.g. "stripe"; null for a manual mark. */
    provider: text("provider"),
    providerRef: text("provider_ref"),
    note: text("note"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("booking_payments_booking_unique").on(table.bookingId),
    index("booking_payments_shop_status_idx").on(table.shopId, table.status),
    check(
      "booking_payments_amount_nonnegative",
      sql`${table.amountCents} is null or ${table.amountCents} >= 0`,
    ),
  ],
);

/**
 * What caused one `booking_payments` transition. A code, never a sentence —
 * the UI picks the words (docs ADR 20260731-domain-layer-copy-leaks).
 *
 * `manual_mark` is the fallback for an unannotated write, which is exactly
 * what such a write is: a staff member setting the status by hand from the
 * roster or the diver record. Every machine writer states its own operation.
 */
export const paymentEventOperation = pgEnum("payment_event_operation", [
  /** Staff set the status by hand (roster payment control, diver record). */
  "manual_mark",
  /** A Stripe Checkout session settled and cascaded onto its covered bookings. */
  "checkout_settled",
  /** A Stripe invoice (staff order) reported paid. */
  "order_settled",
  /** One or more prepaid package tanks covered a booking. */
  "package_consumed",
  /** A cancellation returned prepaid package tanks to the diver. */
  "package_released",
  /** A staff order was refunded through Stripe. */
  "order_refunded",
  /** The automated cancellation-window refund reversed a Stripe capture. */
  "cancellation_refund",
  /**
   * The *shop* cancelled the departure — a weather blow-out or the
   * minimum-head-count sweep — and the capture was reversed unconditionally.
   * Deliberately distinct from `cancellation_refund`: that one is a diver
   * changing their mind inside a stated window, this one is the shop taking the
   * trip away, and only the first has a window that could have refused it
   * (ADR 20260813-shop-cancellation-refunds-itself).
   */
  "shop_cancellation_refund",
  /**
   * A refund somebody made **outside DiveDay** — in the shop's own Stripe
   * dashboard, say — reported by the `charge.refunded` webhook and recorded so
   * the seat, the order and Reports agree with Stripe
   * (ADR 20261009-stripe-reversals-reach-diveday).
   */
  "stripe_dashboard_refund",
]);

/**
 * Append-only money history for one booking — one row per **transition** of
 * its `booking_payments` state (DATA-M3, ADR 20260803-booking-payment-events).
 *
 * `booking_payments` is a single mutable row: a refund overwrites the capture
 * it reverses, so before this table the only record that a booking was ever
 * paid — and for how much, in which currency, against which Stripe object —
 * lived at Stripe. This is DiveDay's own ledger of the same facts, written
 * inside the *same transaction* as every `booking_payments` mutation (there is
 * one funnel, `setBookingPayment` in src/db/payments.ts), so a row here and the
 * current row can never disagree about what happened.
 *
 * Shaped like the repo's other append-only trails (`roll_call_events`,
 * `activity_events`): nothing is ever updated or deleted in place, the newest
 * row for a booking restates its current state, and a correction is a further
 * row rather than a rewrite.
 *
 * **Transitions, not writes.** A write that changes nothing material — a
 * replayed Stripe webhook re-running its self-healing cascade over an
 * already-settled booking — appends no row, so the trail stays a readable
 * history instead of a delivery log. `setBookingPayment` compares against the
 * current row and skips the append when status, amount, currency, provider,
 * provider reference and note are all unchanged.
 *
 * **Refusals are not here.** `setBookingPaymentIfNotFinal` swallowing a lesser
 * status over a refunded/waived row (or over a cancelled booking) mutates
 * nothing, so it appends nothing; those refusals are already reported as
 * `payment.refused_*` log lines.
 */
export const bookingPaymentEvents = pgTable(
  "booking_payment_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * `onDelete: "cascade"` on both parents, unlike `booking_payments`, whose
     * rows the demo reaper and demo-schedule reset each clear by hand from
     * their own topologically-sorted child-first lists (src/db/seed.ts). A
     * trail row describes exactly one booking of exactly one shop and has no
     * meaning once that booking is gone, and the two hand-maintained lists are
     * precisely where a forgotten child surfaces as an FK violation mid-reap.
     * The same reasoning `internal_notes.booking_id` and
     * `activity_events.trip_id` already use.
     */
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    /** The state this transition moved the booking's payment *to*. */
    status: paymentStatus("status").notNull(),
    /**
     * The state it moved *from*. Null means there was no `booking_payments`
     * row yet — this is the booking's first-ever payment event, not a
     * transition out of `unpaid` that somebody recorded.
     */
    previousStatus: paymentStatus("previous_status"),
    /**
     * Money recorded by this transition, in `currency`'s minor unit. Null
     * carries `booking_payments.amount_cents`'s own meaning: no amount was
     * stated — a waiver, or a mark made without one — which is not the same
     * as zero (a refund that reversed nothing).
     */
    amountCents: integer("amount_cents"),
    /**
     * ISO 4217, lowercase, copied from the mutation that caused this row.
     * No default on purpose: an amount whose currency was guessed is not
     * evidence (docs ADR 20260731-shop-currency), and every writer of
     * `booking_payments` already states it.
     */
    currency: text("currency").notNull(),
    /** Provider that moved the money, e.g. "stripe"; null for a manual mark. */
    provider: text("provider"),
    /** The provider object this transition points at (session, invoice, refund). */
    providerRef: text("provider_ref"),
    /** What caused it. See {@link paymentEventOperation}. */
    operation: paymentEventOperation("operation").notNull(),
    /** Whatever note the mutation carried; null when it carried none. */
    note: text("note"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * Backs `listBookingPaymentEvents` (src/db/payments.ts) — one booking's
     * money history for one shop, newest first. Shop-scoped leading column so
     * the tenant predicate is index-served, exactly like
     * `roll_call_events_shop_trip_checkpoint_booking_occurred_idx`.
     */
    index("booking_payment_events_shop_booking_occurred_idx").on(
      table.shopId,
      table.bookingId,
      table.occurredAt,
    ),
    check(
      "booking_payment_events_amount_nonnegative",
      sql`${table.amountCents} is null or ${table.amountCents} >= 0`,
    ),
  ],
);

/**
 * One connected Stripe account per shop (Connect, Standard — the shop's own
 * account, not a platform-controlled sub-account). Presence plus
 * `charges_enabled` is the sole readiness gate for creating an order; absence
 * or a disconnect fails closed to "not connected", never a silent retry.
 * See 20260719-stripe-connect-orders.
 */
export const shopStripeAccounts = pgTable(
  "shop_stripe_accounts",
  {
    shopId: uuid("shop_id")
      .primaryKey()
      .references(() => shops.id),
    stripeAccountId: text("stripe_account_id").notNull(),
    chargesEnabled: boolean("charges_enabled").notNull().default(false),
    payoutsEnabled: boolean("payouts_enabled").notNull().default(false),
    detailsSubmitted: boolean("details_submitted").notNull().default(false),
    /**
     * The connected account's own settlement currency (Stripe's
     * `default_currency`, e.g. "usd", "eur"), refreshed alongside the status
     * flags above. Defaults "usd" for a not-yet-refreshed row so every
     * existing caller keeps working unchanged. Consumers that show a diver a
     * currency symbol (recap tipping) or charge a card must read this instead
     * of a hardcoded "$"/"usd" (task 60) — full multi-currency support
     * elsewhere (orders, checkouts, invoicing) is still deferred (task 35).
     */
    defaultCurrency: text("default_currency").notNull().default("usd"),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    /** Set on an OAuth deauthorize webhook; a later reconnect clears it. */
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("shop_stripe_accounts_stripe_account_unique").on(table.stripeAccountId)],
);

export const orderStatus = pgEnum("order_status", [
  "open",
  "paid",
  "void",
  "uncollectible",
  /**
   * Part of what was captured has been sent back and part is still held
   * (issue #699). Distinct from `refunded`, which means nothing is left:
   * `amount_paid_cents` is still positive here and still counts as revenue,
   * and a further refund of the remainder is still allowed.
   */
  "partly_refunded",
  "refunded",
]);

/**
 * How an order's money was taken (ADR 20261009-counter-payments).
 * `stripe_invoice` is the ordinary path: a Stripe invoice on the shop's
 * connected account, settled by webhook. `cash` and `card_machine` are paid at
 * the counter outside Stripe and recorded already paid; such an order carries
 * no Stripe ids, and every Stripe operation refuses it.
 */
export const orderCollection = pgEnum("order_collection", [
  "stripe_invoice",
  "cash",
  "card_machine",
]);

/**
 * What one order line represents — free-form `other` always available since
 * shops will invoice things this catalog doesn't anticipate.
 */
export const orderLineItemKind = pgEnum("order_line_item_kind", [
  "trip_fee",
  "course_fee",
  /** The agency e-learning code, billed as its own line beside course_fee. */
  "e_learning_fee",
  "rental",
  /** Enriched air, charged per dive on top of the trip fee. */
  "nitrox",
  "deposit",
  /**
   * A prepaid dive package (ADR 20260822-a-package-is-entitlements-not-money).
   * Its own kind rather than `other`, because the open revenue-recognition
   * question in that ADR cannot be answered from a bucket that also holds air
   * fills — whichever way it is settled, "how much of this shop's money is
   * prepaid dives not yet taken" has to be a question the orders table can
   * answer.
   */
  "dive_package",
  "pass_through_fee",
  "merchandise",
  "other",
]);

/**
 * A shop-issued order/invoice for one customer. Local, provider-neutral
 * status mirrors the Stripe invoice it is backed by; `booking_id` is optional
 * so an order can stand alone (retail sale, walk-in air fill) or settle a
 * booking's payment gate through the webhook (20260719-stripe-connect-orders).
 */
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    bookingId: uuid("booking_id").references(() => bookings.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    createdByPersonId: uuid("created_by_person_id")
      .notNull()
      .references(() => people.id),
    status: orderStatus("status").notNull().default("open"),
    currency: text("currency").notNull(),
    totalCents: integer("total_cents").notNull(),
    /** Shop-configured conservation/park fee charged separately per diver. */
    passThroughCents: integer("pass_through_cents").notNull().default(0),
    /** Tax included in Stripe's total, retained separately for reporting and display. */
    taxCents: integer("tax_cents").notNull().default(0),
    amountPaidCents: integer("amount_paid_cents").notNull().default(0),
    /**
     * The running total sent back, in minor units — the sum of every refund
     * this order has had, and never reset (issue #699).
     *
     * `amount_paid_cents` is the money still held and falls as this rises, so
     * the two together are the whole story: gross captured is their sum. It
     * exists because `amount_paid_cents` alone cannot tell a partly-refunded
     * $200 order from a $100 order that was always $100, which is a
     * distinction an owner reading a refund history needs and the revenue
     * figure does not.
     *
     * Incremented by the amount **Stripe reports refunding**, never by what
     * was asked for: Stripe is the authority on what actually moved (ADR
     * 20260806-stale-quote-and-refund-lock).
     */
    refundedCents: integer("refunded_cents").notNull().default(0),
    description: text("description"),
    /** How the money was taken; anything but `stripe_invoice` has no Stripe ids. */
    collection: orderCollection("collection").notNull().default("stripe_invoice"),
    stripeAccountId: text("stripe_account_id"),
    stripeCustomerId: text("stripe_customer_id"),
    stripeInvoiceId: text("stripe_invoice_id"),
    /**
     * The PaymentIntent that paid the invoice, read off `invoice.paid` (or
     * asked of Stripe the first time a refund or dispute names it). It is the
     * only handle a `charge.refunded` or `charge.dispute.*` event carries back
     * to this order (ADR 20261009-stripe-reversals-reach-diveday). Null until
     * paid, and always null on an order paid at the counter.
     */
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    hostedInvoiceUrl: text("hosted_invoice_url"),
    invoicePdfUrl: text("invoice_pdf_url"),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("orders_stripe_invoice_unique").on(table.stripeInvoiceId),
    index("orders_stripe_payment_intent_idx").on(table.stripePaymentIntentId),
    index("orders_shop_status_idx").on(table.shopId, table.status),
    index("orders_shop_booking_idx").on(table.shopId, table.bookingId),
    /** Backs listOrdersForPerson — the person-first diver workspace's payment history. */
    index("orders_shop_person_idx").on(table.shopId, table.personId),
    // Backs the command-palette's orders arm, which searches an order's own
    // description alongside the payer's name (src/db/search.ts) — a leading
    // wildcard, so only a trigram GIN index can serve it (DATA-L6). The payer
    // half of that `or` already rides `people_full_name_trgm_idx`; this is the
    // half that was scanning every order the shop has ever written.
    index("orders_description_trgm_idx").using("gin", sql`${table.description} gin_trgm_ops`),
    check("orders_total_nonnegative", sql`${table.totalCents} >= 0`),
    check("orders_pass_through_nonnegative", sql`${table.passThroughCents} >= 0`),
    check("orders_tax_nonnegative", sql`${table.taxCents} >= 0`),
    check("orders_amount_paid_nonnegative", sql`${table.amountPaidCents} >= 0`),
    check("orders_refunded_nonnegative", sql`${table.refundedCents} >= 0`),
    check(
      "orders_stripe_ids_match_collection",
      sql`(${table.collection} = 'stripe_invoice' and ${table.stripeAccountId} is not null and ${table.stripeCustomerId} is not null and ${table.stripeInvoiceId} is not null) or (${table.collection} <> 'stripe_invoice' and ${table.stripeAccountId} is null and ${table.stripeCustomerId} is null and ${table.stripeInvoiceId} is null and ${table.stripePaymentIntentId} is null)`,
    ),
  ],
);

/**
 * A ledger of every Stripe webhook event this app has ever accepted, keyed by
 * Stripe's own globally-unique event id. The row does **two separate jobs**,
 * and they are deliberately carried by two different columns:
 *
 *  1. **The dedup claim** — `claimed_at`. `POST /api/webhooks/stripe` claims an
 *     event here before doing anything else, so a redelivered event is a no-op
 *     before it ever reaches a handler; belt-and-suspenders on top of each
 *     handler's own idempotent state machine (docs ADR
 *     20260719-stripe-connect-orders). A handler that throws *releases* the
 *     claim (`claimed_at` back to null) so Stripe's own retry genuinely
 *     re-reaches the handler (PAY-M1).
 *  2. **Chronological evidence** — `occurred_at`, Stripe's own event-creation
 *     time (not when we received it), which lets the `account.updated` handler
 *     — otherwise pure last-write-wins — refuse to apply an event that is
 *     chronologically older than one already delivered for the same connected
 *     account (`hasNewerAccountUpdate`).
 *
 * The row is therefore **never deleted**: releasing a claim nulls `claimed_at`
 * and leaves the evidence standing. Deleting it instead would erase job 2 to
 * do job 1, and a *different*, older `account.updated` would then read as
 * fresh and regress `charges_enabled` — fail-open on the flag that gates order
 * and checkout creation.
 */
export const stripeWebhookEvents = pgTable(
  "stripe_webhook_events",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    /** The connected account the event happened on; null for platform-only events. */
    account: text("account"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * When this event's handling was claimed. Non-null means "claimed, and
     * treat every redelivery as a duplicate"; null means the delivery was
     * attempted, the handler failed, and the claim was given back so a
     * redelivery re-runs it. The row itself survives either way — it is still
     * the evidence that an event with this `occurred_at` was delivered.
     *
     * Defaulted rather than left bare so the column's arrival backfills every
     * pre-existing row as claimed (Postgres applies an `ADD COLUMN` default to
     * existing rows): those events were all handled successfully under the
     * old model, and a migration must not silently re-open them to redelivery.
     */
    claimedAt: timestamp("claimed_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("stripe_webhook_events_account_type_idx").on(table.account, table.type, table.occurredAt),
  ],
);

/**
 * A hosted Stripe Checkout attempt for a public booking (or party of
 * bookings), on the shop's connected account. `pending` means the diver was
 * handed a payment link that may still be paid; `completed` is only ever set
 * from Stripe's own evidence (webhook or a direct API read), never from a
 * return-URL claim. Abandonment costs nothing: the bookings it covers simply
 * stay unpaid, exactly as if the shop had no checkout at all.
 * See 20260721-checkout-at-booking.
 */
export const checkoutStatus = pgEnum("checkout_status", ["pending", "completed", "expired"]);

export const bookingCheckouts = pgTable(
  "booking_checkouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id),
    status: checkoutStatus("status").notNull().default("pending"),
    stripeAccountId: text("stripe_account_id").notNull(),
    stripeSessionId: text("stripe_session_id").notNull(),
    /**
     * The `cus_…` object Stripe created for this session, once Stripe says one
     * exists. Sessions are opened with `customer_creation: "if_required"`, so
     * Stripe mints a Customer only when it settles (or attempts to) and never
     * for an abandoned one: **null means no Customer object was created**, not
     * that a write was missed. Recorded so diver erasure can raise a real
     * obligation against it instead of guessing (issue #1621, ADR
     * 20260803-processor-erasure-obligations) — the same class of pointer
     * `orders.stripe_customer_id` already carries, and excluded from the shop
     * export for the same reason.
     *
     * **For a row written before `20260911222255_checkout-stripe-customer`,
     * null also means the column did not exist yet**, and nothing on the row
     * tells that apart from the abandoned case. A `pending` row self-heals —
     * the webhook and `refreshCheckoutFromStripe` both record what Stripe
     * reports — but a `completed` one is never read from Stripe again, so its
     * null is permanent. There is no backfill because H-49 says so: the rows
     * predating the column are seed and demo data. The promise that survives
     * either way is the manual half — `pushSessionTargets` raises
     * `stripe_checkout_session_snapshot` for every session row regardless of
     * this column, so an owner still files Stripe's data-deletion request and
     * erasure never reports that nothing is owed (`security-reviewer`,
     * 2026-09-12).
     */
    stripeCustomerId: text("stripe_customer_id"),
    /** Stripe's hosted payment page; shown again as the recovery link while the session is open. */
    checkoutUrl: text("checkout_url"),
    /**
     * The email Stripe received at checkout creation (`customerEmail` on
     * `startBookingCheckout`), stored durably here. For a party checkout this
     * is the one submitter's address — `booking_checkout_bookings` links every
     * covered booking with no lead/ordering marker, so re-deriving "the
     * purchaser" from that join is unreliable; this column is the actual
     * source of truth for who to contact about this checkout attempt
     * (abandoned-cart recovery, docs ADR 20260726-abandoned-checkout-recovery).
     */
    customerEmail: text("customer_email"),
    /** Set once a recovery email has gone out, so a re-run of the recovery scan never double-sends. */
    abandonedRecoverySentAt: timestamp("abandoned_recovery_sent_at", { withTimezone: true }),
    /**
     * The shop-wide promo code handed to Stripe on this attempt, if any. This
     * is what a completed checkout records a redemption against (docs ADR
     * 20260729-shop-promo-codes). Null for an undiscounted checkout and for a
     * trip-scoped last-minute deal, which has its own row and lands on
     * `trip_promo_id` below instead.
     */
    promoCodeId: uuid("promo_code_id").references(() => shopPromoCodes.id),
    /**
     * The trip-scoped last-minute deal handed to Stripe on this attempt, if any
     * (docs ADR 20260727-last-minute-fill-promos). The counterpart to
     * `promo_code_id`: at most one of the two is ever set, because the caller
     * resolves a trip deal *or* a shop-wide code, never both — a check
     * constraint below holds that. Null on every row written before this column
     * existed, including ones that did apply a trip deal; see
     * `applied_discount_percent`.
     */
    tripPromoId: uuid("trip_promo_id").references(() => tripLastMinutePromos.id),
    /**
     * The code text the diver actually typed, from whichever of the two sources
     * above it resolved against. A snapshot, so a later edit or delete of the
     * code can't rewrite what this diver was quoted.
     */
    promoCode: text("promo_code"),
    /**
     * Percent off, as applied to *this* session at the moment it was created —
     * the one figure that makes the discount reconstructible later without
     * asking Stripe anything (PAY-M3). Both promotion flavors are percent-only
     * by house rule (`trip_last_minute_promos_discount_range` 5..90,
     * `shop_promo_codes_discount_range` 1..100) and neither restricts the
     * coupon to particular line items, so a single percent describes the whole
     * discount on the whole session, gear lines included.
     *
     * Written only when a promotion code was genuinely handed to Stripe, never
     * merely because one was available, and never re-derived afterwards from
     * whatever promo happens to be live on the trip — that would discount
     * full-price divers on a promoted trip and under-refund people who owe
     * nothing.
     *
     * Null means "no discount snapshot exists": an undiscounted checkout, or a
     * row written before this column existed. Those older rows keep the
     * conservative pre-column behaviour — a shop-wide code is still
     * reconstructible from `promo_code_id`, and anything else falls back to the
     * asked total (`attributableTotalCents`, src/db/checkouts.ts). A completion
     * is never refused and never recorded as zero for want of this figure.
     */
    appliedDiscountPercent: integer("applied_discount_percent"),
    currency: text("currency").notNull(),
    /** Price snapshot at checkout time, so a later trip re-price never rewrites what was asked. */
    amountPerDiverCents: integer("amount_per_diver_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    /** Snapshot of the separately reported pass-through fee total. */
    passThroughCents: integer("pass_through_cents").notNull().default(0),
    /** Snapshot of whether Stripe Tax was enabled when this session was created. */
    taxEnabled: boolean("tax_enabled").notNull().default(false),
    /** Stripe-reported tax for the completed session; null while no evidence exists. */
    taxCents: integer("tax_cents"),
    /**
     * What actually *settled*, as Stripe itself reported it on the completed
     * session (`amount_total`) — the counterpart to `totalCents` above, which
     * is what DiveDay *asked* for. The two differ whenever Stripe applied a
     * discount, so this is the only figure a refund or a revenue report may
     * treat as money the shop received. Null means no settled figure exists:
     * a row predating this column, a checkout that never completed, or a
     * completion where Stripe reported no total — callers fall back to the
     * asked amounts rather than treating null as zero.
     */
    settledTotalCents: integer("settled_total_cents"),
    /**
     * True when the amount charged is a deposit (a balance is still due), so a
     * completed session settles the covered bookings to `deposit_paid` rather
     * than `paid`. False (the default) is the full-fare checkout.
     */
    isDeposit: boolean("is_deposit").notNull().default(false),
    /** Stripe expires unfinished Checkout sessions; kept so the UI can be honest about a dead link. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /**
     * When Stripe reported this session's delayed-notification payment
     * *failed* (`checkout.session.async_payment_failed`, PAY-L1). Null is the
     * normal state and means only "no failure was reported" — not that the
     * payment succeeded.
     *
     * A session whose async payment failed can no longer be paid, so the row's
     * `status` moves to `expired`, the existing terminal for "this local
     * checkout is no longer payable": recovery emails stop
     * (`dueCheckoutRecovery`), a later completion cannot resurrect it
     * (`markCheckoutPaidBySessionId`'s disqualification check), and no
     * `booking_payments` row is touched because none was ever written for an
     * unsettled async payment. This column is what keeps the two causes apart —
     * a session that simply timed out unpaid versus one whose payment was
     * attempted and bounced — without adding a `checkout_status` value that
     * every consumer of that enum would have to learn
     * (ADR 20260803-async-payment-failed).
     */
    asyncPaymentFailedAt: timestamp("async_payment_failed_at", { withTimezone: true }),
    /**
     * The PaymentIntent the session settled through, off its completion
     * event. The handle a `charge.refunded` or `charge.dispute.*` event
     * carries back to this checkout (ADR 20261009-stripe-reversals-reach-diveday).
     */
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    /**
     * Minor units reversed off this session's charge so far, by every path:
     * DiveDay's own cancellation refunds and a refund made in the Stripe
     * dashboard alike. The checkout's twin of `orders.refunded_cents`, and the
     * figure Stripe's cumulative `amount_refunded` is compared against, so a
     * refund DiveDay made itself is never counted a second time when its
     * webhook arrives.
     */
    refundedCents: integer("refunded_cents").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("booking_checkouts_stripe_session_unique").on(table.stripeSessionId),
    index("booking_checkouts_stripe_payment_intent_idx").on(table.stripePaymentIntentId),
    check("booking_checkouts_refunded_nonnegative", sql`${table.refundedCents} >= 0`),
    index("booking_checkouts_shop_trip_idx").on(table.shopId, table.tripId),
    check("booking_checkouts_amount_per_diver_nonnegative", sql`${table.amountPerDiverCents} >= 0`),
    check("booking_checkouts_total_nonnegative", sql`${table.totalCents} >= 0`),
    check("booking_checkouts_pass_through_nonnegative", sql`${table.passThroughCents} >= 0`),
    check(
      "booking_checkouts_settled_total_nonnegative",
      sql`${table.settledTotalCents} is null or ${table.settledTotalCents} >= 0`,
    ),
    check(
      "booking_checkouts_tax_nonnegative",
      sql`${table.taxCents} is null or ${table.taxCents} >= 0`,
    ),
    // The snapshot of what Stripe was told to take off this session. Bounded to
    // a real percentage so a corrupt value can never reconstruct a *larger*
    // attributable total than was asked for — 1..100 spans both flavors'
    // own ranges (trip deals 5..90, shop-wide codes 1..100).
    check(
      "booking_checkouts_applied_discount_range",
      sql`${table.appliedDiscountPercent} is null or ${table.appliedDiscountPercent} between 1 and 100`,
    ),
    // A checkout applies a trip-scoped deal *or* a shop-wide code, never both:
    // the caller resolves them in that order and stops at the first hit, and
    // Stripe Checkout accepts one promotion code per session anyway. Held here
    // so no future caller can quietly record two and leave the reconstruction
    // guessing which percent was the one Stripe applied.
    check(
      "booking_checkouts_single_promo_source",
      sql`${table.promoCodeId} is null or ${table.tripPromoId} is null`,
    ),
    // The abandoned-checkout-recovery scan's exact predicate (pending, not yet
    // recovered), so the daily cron doesn't force a sequential scan of the
    // whole table's history as it grows (docs ADR
    // 20260726-abandoned-checkout-recovery).
    index("booking_checkouts_recovery_scan_idx")
      .on(table.createdAt)
      .where(sql`${table.status} = 'pending' and ${table.abandonedRecoverySentAt} is null`),
  ],
);

/** The bookings one checkout pays for — a party checkout covers several. */
export const bookingCheckoutBookings = pgTable(
  "booking_checkout_bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    checkoutId: uuid("checkout_id")
      .notNull()
      .references(() => bookingCheckouts.id),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    /**
     * This diver's priced rental-gear subtotal on this checkout, snapshotted
     * at checkout-creation time (docs ADR 20260801-checkout-upsells-rental-gear).
     * 0 means either no gear was chosen or (for a historical row predating
     * this column) gear was never part of checkout — both read the same way:
     * nothing to attribute to gear for this diver on this payment.
     */
    /** This booking's trip-fee share after package coverage, snapshotted. */
    tripCents: integer("trip_cents"),
    /** This booking's allocated pass-through fee, excluded from revenue. */
    passThroughCents: integer("pass_through_cents").notNull().default(0),
    gearCents: integer("gear_cents").notNull().default(0),
    /** Allocated share of the checkout's Stripe-reported tax. */
    taxCents: integer("tax_cents").notNull().default(0),
  },
  (table) => [
    uniqueIndex("booking_checkout_bookings_checkout_booking_unique").on(
      table.checkoutId,
      table.bookingId,
    ),
    index("booking_checkout_bookings_booking_idx").on(table.bookingId),
    check("booking_checkout_bookings_gear_cents_nonnegative", sql`${table.gearCents} >= 0`),
    check(
      "booking_checkout_bookings_pass_through_nonnegative",
      sql`${table.passThroughCents} >= 0`,
    ),
    check("booking_checkout_bookings_tax_cents_nonnegative", sql`${table.taxCents} >= 0`),
    check(
      "booking_checkout_bookings_trip_cents_nonnegative",
      sql`${table.tripCents} is null or ${table.tripCents} >= 0`,
    ),
  ],
);

/**
 * A card dispute (a chargeback, or an inquiry before one) a diver's bank opened
 * against a charge DiveDay took — one row per Stripe dispute, kept current by
 * the `charge.dispute.*` webhooks (ADR 20261009-stripe-reversals-reach-diveday).
 *
 * Exactly one of `order_id`/`checkout_id` names what was disputed: a dispute on
 * a charge DiveDay never made (the shop's own till on the same Stripe account)
 * is not recorded at all. While `closed_at` is null the owner sees a Today row
 * with the amount and the evidence deadline.
 *
 * Informs, never moves money: a lost dispute is Stripe taking the funds back,
 * which the shop sees in its own Stripe balance; nothing here rewrites the
 * order or the seat.
 */
export const paymentDisputes = pgTable(
  "payment_disputes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    stripeAccountId: text("stripe_account_id").notNull(),
    stripeDisputeId: text("stripe_dispute_id").notNull(),
    stripePaymentIntentId: text("stripe_payment_intent_id").notNull(),
    orderId: uuid("order_id").references(() => orders.id),
    checkoutId: uuid("checkout_id").references(() => bookingCheckouts.id),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    /** Stripe's own reason code (`fraudulent`, `product_not_received`, …), verbatim. */
    reason: text("reason"),
    /** Stripe's own status code (`needs_response`, `under_review`, `won`, …), verbatim. */
    status: text("status").notNull(),
    /** When Stripe stops accepting evidence. Null when Stripe names no deadline. */
    evidenceDueBy: timestamp("evidence_due_by", { withTimezone: true }),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    /** Set once the dispute is decided (won, lost, or a warning closed). */
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /**
     * The `created` time of the newest event applied. An older event delivered
     * late never overwrites a newer one — Stripe does not promise order.
     */
    lastEventAt: timestamp("last_event_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("payment_disputes_stripe_dispute_unique").on(table.stripeDisputeId),
    /** Today's read: one shop's undecided disputes. */
    index("payment_disputes_shop_open_idx")
      .on(table.shopId, table.evidenceDueBy)
      .where(sql`${table.closedAt} is null`),
    index("payment_disputes_shop_order_idx").on(table.shopId, table.orderId),
    check("payment_disputes_amount_nonnegative", sql`${table.amountCents} >= 0`),
    check(
      "payment_disputes_one_target",
      sql`(${table.orderId} is null) <> (${table.checkoutId} is null)`,
    ),
  ],
);

export const tipStatus = pgEnum("tip_status", ["pending", "paid", "expired"]);

/**
 * A post-trip tip, a hosted Stripe Checkout the diver's own recap page
 * offers. Deliberately its own small table rather than reusing
 * `booking_checkouts`: a tip is always exactly one booking (never a party),
 * settles no booking-payment gate, and its webhook handling must never be
 * able to cascade into `markCheckoutPaidBySessionId`'s booking-paid logic —
 * same shape (status/session/checkout URL lifecycle), separate concern
 * (docs ADR 20260726-post-trip-tipping).
 */
export const tips = pgTable(
  "tips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    status: tipStatus("status").notNull().default("pending"),
    stripeAccountId: text("stripe_account_id").notNull(),
    stripeSessionId: text("stripe_session_id").notNull(),
    /**
     * The `cus_…` object Stripe created for this tip's session, once Stripe
     * says one exists — same rule as `booking_checkouts.stripe_customer_id`:
     * `customer_creation: "if_required"` means null is "Stripe created no
     * Customer", never "we forgot to write it" (issue #1621) — and the same
     * exception, that a row written before
     * `20260911222255_checkout-stripe-customer` is null too, unbackfilled under
     * H-49, with the session snapshot still owed for it
     * (`security-reviewer`, 2026-09-12).
     */
    stripeCustomerId: text("stripe_customer_id"),
    /**
     * The PaymentIntent the tip was paid with, written once when the session
     * completes. Only so a refund or a dispute of a tip is recognised as one
     * and Stripe is not asked about it (ADR 20261009-stripe-reversals-reach-diveday);
     * nothing records a tip's reversal yet.
     */
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    checkoutUrl: text("checkout_url"),
    currency: text("currency").notNull(),
    amountCents: integer("amount_cents").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("tips_stripe_session_unique").on(table.stripeSessionId),
    index("tips_shop_booking_idx").on(table.shopId, table.bookingId),
    index("tips_stripe_payment_intent_idx").on(table.stripePaymentIntentId),
    check("tips_amount_positive", sql`${table.amountCents} > 0`),
  ],
);

export const orderLineItems = pgTable(
  "order_line_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    /** Set for a package line so a later paid webhook can grant it. */
    packageId: uuid("package_id").references(() => divePackages.id),
    kind: orderLineItemKind("kind").notNull().default("other"),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull().default(1),
    unitAmountCents: integer("unit_amount_cents").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("order_line_items_order_idx").on(table.orderId),
    check("order_line_items_quantity_positive", sql`${table.quantity} > 0`),
    check("order_line_items_unit_amount_nonnegative", sql`${table.unitAmountCents} >= 0`),
  ],
);

export const paymentOperationKind = pgEnum("payment_operation_kind", [
  "checkout_session",
  "invoice",
  "refund",
]);

/**
 * `started` is written and committed *before* the Stripe call it describes —
 * the durable evidence a crash between "Stripe was asked" and "the local
 * order/checkout/payment row was written" leaves behind. `succeeded`/`failed`
 * mean the Stripe call itself returned; a row still `started` past a short
 * staleness window is exactly the "indeterminate operation" CR-005 exists to
 * surface (`listStuckPaymentOperations`, src/db/payment-operations.ts).
 */
export const paymentOperationStatus = pgEnum("payment_operation_status", [
  "started",
  "succeeded",
  "failed",
]);

/**
 * One row per attempted Stripe side effect (create a Checkout session, create
 * or refund an invoice, refund a checkout) — written before the call, not
 * after, so the attempt itself is durable even if the process dies mid-call
 * or the local order/checkout/payment write that should follow never
 * happens. `id` is also the deterministic idempotency-key material
 * (`idempotencyKeyFor`, src/db/payment-operations.ts): retrying the same
 * logical attempt reuses the same intent row and the same Stripe idempotency
 * key, so a retry after a lost response converges on one Stripe object
 * instead of creating a second one. Exactly one of `tripId`/`bookingId`/
 * `orderId`/`checkoutId` is populated, matching `kind` (CR-005).
 */
export const paymentOperationIntents = pgTable(
  "payment_operation_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    kind: paymentOperationKind("kind").notNull(),
    status: paymentOperationStatus("status").notNull().default("started"),
    /** Set for a checkout_session intent — which trip's booking(s) this session is for. */
    tripId: uuid("trip_id").references(() => trips.id),
    /**
     * Set for an invoice intent that settles a booking's payment gate (null
     * for a booking-less order), or for a checkout-refund intent
     * (refundBookingOnCancellation operates by bookingId, not a
     * booking_checkouts row — it never has one in hand).
     */
    bookingId: uuid("booking_id").references(() => bookings.id),
    /** Set for a refund intent against an order's invoice. */
    orderId: uuid("order_id").references(() => orders.id),
    /** Reserved for a future refund path that has a booking_checkouts row in hand; no caller sets this today. */
    checkoutId: uuid("checkout_id").references(() => bookingCheckouts.id),
    /** The Stripe object id once known, even if the local finalize write then failed. */
    stripeObjectId: text("stripe_object_id"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    index("payment_operation_intents_shop_status_idx").on(table.shopId, table.status),
    // `claimBookingsForCheckout`'s stale-intent sweep (src/db/payment-operations.ts,
    // DATA-M1) runs on every checkout click and is deliberately cross-shop, so
    // the `(shop_id, status)` index above cannot serve it at all. Partial on
    // `status = 'started'` because that is the only status the sweep ever looks
    // at and it is a vanishing slice of the table — every intent resolves within
    // one Stripe round trip, so the index stays a handful of rows wide however
    // large the resolved history grows.
    //
    // `kind` leads the key: the sweep pins it (`= 'checkout_session'`) and then
    // takes a range on `started_at`, so equality-before-range is the order a
    // single index scan can walk. (The review that raised DATA-M1 prescribed a
    // bare `(started_at)`; the query also filters `kind`, and including it costs
    // nothing on an index this small.)
    index("payment_operation_intents_stale_scan_idx")
      .on(table.kind, table.startedAt)
      .where(sql`${table.status} = 'started'`),
  ],
);

/**
 * The direction a prior system assigns to an imported financial record. It is
 * deliberately a small, source-evidence vocabulary rather than an Order or
 * Stripe status: `payment` and `refund` can contribute to the unverified
 * import slice of the financial aggregates when their amount and currency are
 * clear; `unknown` remains visible in Orders but never changes a total.
 */
export const importedPaymentDirection = pgEnum("imported_payment_direction", [
  "payment",
  "refund",
  "unknown",
]);

/**
 * Payment and receipt history carried from another system. This is *not* an
 * `orders` row: it has no live Stripe invoice, no booking-payment effect, and
 * no authority to issue or refund money. Every value is source evidence and
 * renders as an unverified import until a future reconciliation explicitly
 * proves otherwise.
 *
 * `amountCents` / `currency` are deliberately paired and nullable. The import
 * parser fills them only for a self-identifying supported currency; those are
 * the only source rows permitted into aggregate revenue/refund math. The raw
 * `amountLabel` is always retained so staff can see exactly what the source
 * said, including an amount too ambiguous to aggregate.
 *
 * A `stripeReference` is a non-authoritative crosswalk seam, not a synthetic
 * Stripe object. It lets a later reconciliation match a source-exported
 * `in_`/`pi_`/`ch_` identifier against the real connected account without ever
 * inventing a charge or retaining card credentials.
 */
export const importedPaymentHistory = pgTable(
  "imported_payment_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    /** Shop-local calendar day the source says this payment/refund occurred. */
    occurredOn: date("occurred_on").notNull(),
    /** Source-derived direction, never a local payment or order status. */
    direction: importedPaymentDirection("direction").notNull().default("unknown"),
    /** What the prior system called the sale, trip, or receipt. */
    title: text("title"),
    /** The source's own status word, preserved rather than mapped. */
    statusLabel: text("status_label"),
    /** Source money text, preserved verbatim whether it can be normalized or not. */
    amountLabel: text("amount_label"),
    /** Parsed only when the amount named a supported currency unambiguously. */
    amountCents: integer("amount_cents"),
    /** Lowercase ISO 4217 code paired with amountCents. */
    currency: text("currency"),
    /** Prior processor/order-system payment identifier, not a credential. */
    paymentReference: text("payment_reference"),
    /** Prior receipt number or reference, not a locally-issued receipt. */
    receiptReference: text("receipt_reference"),
    /** First-party re-stored receipt document only; raw external URLs are never kept. */
    receiptDocumentUrl: text("receipt_document_url"),
    /** Prior shop or source-system label the row carried. */
    sourceLabel: text("source_label"),
    /** Prior booking/order identifier that contextualizes the row. */
    sourceReference: text("source_reference"),
    /** Unverified Stripe object reference retained solely for future reconciliation. */
    stripeReference: text("stripe_reference"),
    /** Stable source/content key that makes re-imports idempotent. */
    dedupeKey: text("dedupe_key").notNull(),
    /** Always set — this table only receives imports, never hand-created payments. */
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("imported_payment_history_shop_person_idx").on(
      table.shopId,
      table.personId,
      table.occurredOn,
    ),
    index("imported_payment_history_shop_date_idx").on(table.shopId, table.occurredOn),
    index("imported_payment_history_shop_currency_direction_idx").on(
      table.shopId,
      table.currency,
      table.direction,
      table.occurredOn,
    ),
    uniqueIndex("imported_payment_history_shop_person_dedupe_unique").on(
      table.shopId,
      table.personId,
      table.dedupeKey,
    ),
    check(
      "imported_payment_history_amount_nonnegative",
      sql`${table.amountCents} IS NULL OR ${table.amountCents} >= 0`,
    ),
    check(
      "imported_payment_history_amount_currency_pair",
      sql`(${table.amountCents} IS NULL AND ${table.currency} IS NULL) OR (${table.amountCents} IS NOT NULL AND ${table.currency} IS NOT NULL)`,
    ),
  ],
);

export type BookingPayment = typeof bookingPayments.$inferSelect;

export type PaymentStatus = (typeof paymentStatus.enumValues)[number];

export type PaymentEventOperation = (typeof paymentEventOperation.enumValues)[number];

export type ShopStripeAccount = typeof shopStripeAccounts.$inferSelect;

export type Order = typeof orders.$inferSelect;

export type OrderStatus = (typeof orderStatus.enumValues)[number];
export type OrderCollection = (typeof orderCollection.enumValues)[number];

export type OrderLineItemKind = (typeof orderLineItemKind.enumValues)[number];

export type StripeWebhookEvent = typeof stripeWebhookEvents.$inferSelect;

export type BookingCheckout = typeof bookingCheckouts.$inferSelect;

export type PaymentDispute = typeof paymentDisputes.$inferSelect;

export type Tip = typeof tips.$inferSelect;

export type ShopPromoCode = typeof shopPromoCodes.$inferSelect;

export type PaymentOperationIntent = typeof paymentOperationIntents.$inferSelect;

export type PaymentOperationKind = (typeof paymentOperationKind.enumValues)[number];
