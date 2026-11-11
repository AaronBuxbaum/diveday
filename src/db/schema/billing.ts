import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  foreignKey,
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
import { PRICING_PLAN_SOURCES, PRICING_PLANS } from "@/lib/billing/pricing-plans";
import { STRIPE_SUBSCRIPTION_STATUSES } from "@/lib/billing/standing";
import { appNowTimestamp } from "./columns";
import { shops } from "./core";

/** Stripe's subscription statuses, mirrored as stored (src/lib/billing/standing.ts). */
export const stripeSubscriptionStatus = pgEnum(
  "stripe_subscription_status",
  STRIPE_SUBSCRIPTION_STATUSES,
);

/** The pricing A/B test's two plans (src/lib/billing/pricing-plans.ts, ADR 20261022-pricing-ab-test). */
export const pricingPlan = pgEnum("pricing_plan", PRICING_PLANS);

/** Who stored a shop's plan: the arm it was assigned, or a person by hand. */
export const pricingPlanSource = pgEnum("pricing_plan_source", PRICING_PLAN_SOURCES);

/**
 * What a shop pays **DiveDay** — the subscription on DiveDay's own Stripe
 * account, not the shop's Connect account above (ADR
 * 20261007-subscription-billing). One row per shop, written lazily: a shop
 * that has never opened Billing, and was never granted a free term, has none,
 * and reads exactly like one with every column empty.
 *
 * The Stripe columns are written by the billing webhook alone; the page never
 * trusts Checkout's redirect. `stripe_customer_id` is the key the webhook
 * resolves a shop by, minted by DiveDay before Checkout opens, so every event
 * names a customer this table already holds. Both Stripe ids are unique, so
 * one customer or subscription can never be claimed by two shops.
 *
 * `free_term_ends_on` is the one column a person sets: the last free day of a
 * term DiveDay granted by hand (H-20260724-public-founding-shop-price's founding-shop months), written by
 * `pnpm billing:free-term`. `first_paid_at` is write-once, the instant the
 * first non-zero invoice was paid — the "first paid month" milestone.
 * Nothing is deleted from here by a person, so there is no `deleted_at`.
 */
export const shopSubscriptions = pgTable(
  "shop_subscriptions",
  {
    shopId: uuid("shop_id")
      .primaryKey()
      .references(() => shops.id),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    stripeStatus: stripeSubscriptionStatus("stripe_status"),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    /**
     * Stripe's own `created` time on the last subscription event applied. An
     * older event arriving later is refused against it, so delivery order can
     * never walk a canceled subscription back to active.
     */
    lastSubscriptionEventAt: timestamp("last_subscription_event_at", { withTimezone: true }),
    /**
     * The Checkout session "Add a card" last opened. Before opening another,
     * the action settles this one at Stripe — expires it if still open, and
     * refuses to open a second if it already completed — so two tabs can
     * never pay for two subscriptions. Cleared by its own
     * `checkout.session.completed`.
     */
    stripeCheckoutSessionId: text("stripe_checkout_session_id"),
    freeTermEndsOn: date("free_term_ends_on", { mode: "string" }),
    firstPaidAt: timestamp("first_paid_at", { withTimezone: true }),
    /**
     * The pricing A/B test's plan (ADR 20261022-pricing-ab-test). Null until
     * one is stored: at signup (the arm the set-up request saw), at "Add a
     * card" (the plan Checkout sold), or by `pnpm billing:pricing-plan`. Read
     * only through `effectivePricing` (src/lib/billing/pricing-plans.ts).
     */
    pricingPlan: pricingPlan("pricing_plan"),
    pricingPlanSource: pricingPlanSource("pricing_plan_source"),
    pricingPlanSetAt: timestamp("pricing_plan_set_at", { withTimezone: true }),
    /**
     * The arm the shop was assigned, kept apart from `pricing_plan` so an
     * override can be undone (`billing:pricing-plan <slug> auto`) back to it.
     */
    assignedPricingPlan: pricingPlan("assigned_pricing_plan"),
    /**
     * **The numbers this shop was sold** (grandfathering): the monthly fee and,
     * on the percent plan, the basis points, snapshotted when Checkout opens
     * or a deal is set by hand. A live subscription keeps them whatever the
     * `PRICING_*` environment says later.
     */
    planMonthlyCents: integer("plan_monthly_cents"),
    planBasisPoints: integer("plan_basis_points"),
    /**
     * Every paid invoice's `amount_paid`, summed by the billing webhook: what
     * this shop has paid DiveDay, the test's revenue per shop. The event
     * ledger makes each invoice count once.
     */
    paidTotalCents: integer("paid_total_cents").notNull().default(0),
    createdAt: appNowTimestamp("created_at").notNull(),
    updatedAt: appNowTimestamp("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("shop_subscriptions_stripe_customer_unique").on(table.stripeCustomerId),
    uniqueIndex("shop_subscriptions_stripe_subscription_unique").on(table.stripeSubscriptionId),
    check(
      "shop_subscriptions_pricing_plan_source_check",
      sql`(${table.pricingPlan} is null) = (${table.pricingPlanSource} is null)`,
    ),
    check(
      "shop_subscriptions_plan_numbers_check",
      sql`(${table.planMonthlyCents} is null or ${table.planMonthlyCents} between 0 and 100000) and (${table.planBasisPoints} is null or ${table.planBasisPoints} between 0 and 1000)`,
    ),
  ],
);

/**
 * **One closed month of a percent-plan shop** (ADR 20261022-pricing-ab-test):
 * the money recorded received by any method in its own calendar month
 * (`processedVolumeCents`), the fee on it, and whether that fee has reached
 * Stripe as a meter event.
 *
 * Written by the monthly cron alone (`src/features/pricing-volume/store.ts`). The unique `(shop_id, month)` is the
 * month's idempotency: a re-run finds the row and, once `reported_at` is set,
 * does nothing; a run that wrote the row but failed to report retries the
 * report with the same figures and the same `stripe_meter_identifier`, which
 * Stripe also deduplicates on. `month` is the first day of the month, as a
 * calendar date in the shop's own zone.
 */
export const pricingVolumeStatements = pgTable(
  "pricing_volume_statements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    month: date("month", { mode: "string" }).notNull(),
    currency: text("currency").notNull().default("usd"),
    /** Net collection lots billed here, retained for original-rate credits. */
    collections: jsonb("collections")
      .$type<Array<{ entryId: number; amountCents: number }>>()
      .notNull()
      .default([]),
    /** Fee before crediting refunds of an earlier statement. */
    grossFeeCents: integer("gross_fee_cents").notNull().default(0),
    /** Original-rate fee credits received here, including any carry. */
    refundCreditCents: integer("refund_credit_cents").notNull().default(0),
    /** Unused fee credit in this currency, never a volume repriced at a later rate. */
    feeCreditCarryCents: integer("fee_credit_carry_cents").notNull().default(0),
    /** New credits, by original statement, so a replay can never credit one twice. */
    credits: jsonb("credits")
      .$type<Array<{ statementId: string; basisCents: number; feeCents: number }>>()
      .notNull()
      .default([]),
    /** Collections less same-month reversals, in this currency's minor units. */
    monthCollectedCents: integer("month_card_cents").notNull().default(0),
    /** Later refunds or failed-refund restorations, credited at the original rate. */
    lateRefundCents: integer("late_refund_cents").notNull().default(0),
    /** This month's net collection basis; prior refunds adjust fees, not this volume. */
    volumeCents: integer("volume_cents").notNull(),
    /** The rate the fee was computed at: the shop's snapshot when the month closed. */
    basisPoints: integer("basis_points").notNull(),
    feeCents: integer("fee_cents").notNull(),
    /** `diveday-fee-<shopId>-<yyyy-mm>`: the meter event's own identifier. */
    stripeMeterIdentifier: text("stripe_meter_identifier").notNull(),
    reportedAt: timestamp("reported_at", { withTimezone: true }),
    /**
     * When the fee was first sent to Stripe, stamped before the call. Null is
     * "never sent"; set with no `reported_at` is "sent, outcome unknown". Past
     * Stripe's 24-hour identifier window the close asks the meter before it
     * sends again, so a lost answer is never billed twice.
     */
    firstReportAttemptAt: timestamp("first_report_attempt_at", { withTimezone: true }),
    createdAt: appNowTimestamp("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("pricing_volume_statements_shop_month_unique").on(
      table.shopId,
      table.month,
      table.currency,
    ),
    check("pricing_volume_statements_fee_check", sql`${table.feeCents} >= 0`),
  ],
);

/**
 * Append-only received-money lots and their linked reversals. One economic source
 * is an order, a checkout, or a hand-marked seat, never both a receipt and its
 * seat cascade. Amounts are native-currency minor units; no exchange rate exists.
 * Source writers hold the source row lock before appending, in the same transaction.
 */
export const collectionEntries = pgTable(
  "collection_entries",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    sourceType: text("source_type").$type<"order" | "checkout" | "booking">().notNull(),
    sourceId: uuid("source_id").notNull(),
    currency: text("currency").notNull(),
    method: text("method").notNull(),
    amountCents: integer("amount_cents").notNull(),
    /** A refund names its collection lot; a failed-refund restoration names that refund. */
    reversesEntryId: bigint("reverses_entry_id", { mode: "number" }),
    /** The exact source facts used for the chargeable balance, not a future reread. */
    evidence: jsonb("evidence").$type<Record<string, number | string | boolean | null>>().notNull(),
    /** Receipt/reversal recording time; first exact checkout evidence retains its completion time. */
    recordedAt: appNowTimestamp("recorded_at").notNull(),
    /** When this immutable accounting row was appended, including delayed evidence. */
    createdAt: appNowTimestamp("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("collection_entries_shop_id_unique").on(table.shopId, table.id),
    index("collection_entries_source_idx").on(
      table.shopId,
      table.sourceType,
      table.sourceId,
      table.id,
    ),
    index("collection_entries_month_idx").on(table.shopId, table.recordedAt),
    foreignKey({
      name: "collection_entries_reversal_shop_fk",
      columns: [table.shopId, table.reversesEntryId],
      foreignColumns: [table.shopId, table.id],
    }),
    check(
      "collection_entries_source_check",
      sql`${table.sourceType} in ('order', 'checkout', 'booking')`,
    ),
    check("collection_entries_currency_check", sql`${table.currency} ~ '^[a-z]{3}$'`),
    check(
      "collection_entries_reversal_check",
      sql`${table.amountCents} <> 0 and (${table.amountCents} > 0 or ${table.reversesEntryId} is not null)`,
    ),
  ],
);
