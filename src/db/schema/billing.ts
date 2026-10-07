import {
  boolean,
  date,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { STRIPE_SUBSCRIPTION_STATUSES } from "@/lib/billing/standing";
import { shops } from "./core";

/** Stripe's subscription statuses, mirrored as stored (src/lib/billing/standing.ts). */
export const stripeSubscriptionStatus = pgEnum(
  "stripe_subscription_status",
  STRIPE_SUBSCRIPTION_STATUSES,
);

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
 * term DiveDay granted by hand (H-12's founding-shop months), written by
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("shop_subscriptions_stripe_customer_unique").on(table.stripeCustomerId),
    uniqueIndex("shop_subscriptions_stripe_subscription_unique").on(table.stripeSubscriptionId),
  ],
);
