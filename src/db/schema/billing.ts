import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  integer,
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
 * the card money it took through DiveDay in its own calendar month
 * (`processedVolumeCents`), the fee on it, and whether that fee has reached
 * Stripe as a meter event.
 *
 * Written by the monthly cron alone (`src/db/pricing-volume.ts`). The unique `(shop_id, month)` is the
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
    /** The month's own card money as read at the close, before any late refund. */
    monthCardCents: integer("month_card_cents").notNull().default(0),
    /**
     * Refunds recorded after an earlier statement closed, plus what that
     * statement carried in, taken off this month's card money (issue 3024).
     */
    lateRefundCents: integer("late_refund_cents").notNull().default(0),
    /** What this month could not absorb of `lateRefundCents`: the next statement takes it. */
    refundCarryCents: integer("refund_carry_cents").notNull().default(0),
    /**
     * How much of this month's card money later statements have credited as
     * late refunds, so a refund is credited once however often it is re-read.
     */
    refundedSinceCloseCents: integer("refunded_since_close_cents").notNull().default(0),
    /** Billed card money: `monthCardCents` less `lateRefundCents`, never below zero. */
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
    uniqueIndex("pricing_volume_statements_shop_month_unique").on(table.shopId, table.month),
    check("pricing_volume_statements_fee_check", sql`${table.feeCents} >= 0`),
  ],
);
