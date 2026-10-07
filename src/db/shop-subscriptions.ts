import { and, eq, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { BillingEventEffect } from "@/lib/billing/events";
import type { SubscriptionSnapshot } from "@/lib/billing/standing";
import { type CalendarDate, isValidCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import type { AppDb, DbExecutor } from "./client";
import { isUniqueConstraintViolation } from "./client";
import { shopSubscriptions, shops } from "./schema";

/**
 * A shop's subscription to DiveDay, as this database knows it (ADR
 * 20261007-subscription-billing). Three writers and no more:
 *
 * - `ensureShopBillingCustomer` — the Billing page's "Add a card", before
 *   Checkout opens, records the Stripe Customer DiveDay minted for the shop.
 * - `applyBillingEffect` — the billing webhook, the only writer of the
 *   subscription's state.
 * - `setShopFreeTerm` — `pnpm billing:free-term`, a person granting free
 *   months by hand.
 *
 * Every read and write is keyed by the shop (from the session) or by the
 * Stripe customer id (from a signed event) — never by an id an event merely
 * claims.
 */

export type ShopSubscriptionRow = typeof shopSubscriptions.$inferSelect;

export async function getShopSubscription(
  db: DbExecutor,
  shopId: string,
): Promise<ShopSubscriptionRow | null> {
  const [row] = await db
    .select()
    .from(shopSubscriptions)
    .where(eq(shopSubscriptions.shopId, shopId))
    .limit(1);
  return row ?? null;
}

/** The subscription the standing reads, or null when Stripe has told us of none. */
export function subscriptionSnapshot(row: ShopSubscriptionRow | null): SubscriptionSnapshot | null {
  if (!row?.stripeSubscriptionId || !row.stripeStatus) return null;
  return {
    status: row.stripeStatus,
    currentPeriodEnd: row.currentPeriodEnd,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
  };
}

/**
 * Record the Stripe Customer minted for this shop, and answer the one the shop
 * is actually bound to. **The first recorded customer wins**: a second tab's
 * "Add a card" racing the first gets the stored id back, never overwrites it,
 * so the customer every later event names is the one this row already holds.
 */
export async function ensureShopBillingCustomer(
  db: AppDb,
  shopId: string,
  stripeCustomerId: string,
): Promise<string> {
  const now = nowDate();
  const [row] = await db
    .insert(shopSubscriptions)
    .values({ shopId, stripeCustomerId, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: shopSubscriptions.shopId,
      set: {
        stripeCustomerId: sql`coalesce(${shopSubscriptions.stripeCustomerId}, excluded.stripe_customer_id)`,
        updatedAt: now,
      },
    })
    .returning({ stripeCustomerId: shopSubscriptions.stripeCustomerId });
  return row?.stripeCustomerId ?? stripeCustomerId;
}

/** Statuses after which a subscription is over, and a new one may take its place. */
const ENDED_STATUSES = ["canceled", "incomplete_expired"] as const;

export type BillingEffectOutcome =
  | "linked"
  | "subscription_updated"
  | "first_paid"
  | "already_paid"
  | "zero_amount"
  | "customer_not_found"
  | "tenant_mismatch"
  | "stale_event"
  | "foreign_subscription"
  | "subscription_claimed_elsewhere"
  | "ignored"
  | "malformed";

/**
 * Apply one verified event's meaning to the shop it belongs to.
 *
 * The shop is found by the Stripe **customer** id and nothing else. Three
 * refusals sit between a signed event and a write, and each answers with a
 * code the webhook logs and then acknowledges (a refusal is not a retry):
 *
 * - `tenant_mismatch` — the event's own `shop_id` claim names a different shop
 *   than the customer belongs to. Nothing is written; somebody wrote metadata
 *   by hand, or two shops' records crossed, and either is for a person to read.
 * - `foreign_subscription` — the event is about a subscription other than the
 *   live one this shop holds. A shop that canceled and subscribed again adopts
 *   the new subscription; a late event from the old one changes nothing.
 * - `stale_event` — Stripe created this event before the last one applied.
 *   Delivery order is not creation order, so the comparison is on Stripe's
 *   `created`, carried on the row, and the guard is inside the `UPDATE`'s own
 *   `WHERE` so two concurrent deliveries cannot both pass a read-then-write.
 */
export async function applyBillingEffect(
  db: AppDb,
  effect: BillingEventEffect,
): Promise<BillingEffectOutcome> {
  if (effect.kind === "ignored") return "ignored";
  if (effect.kind === "malformed") return "malformed";

  const [row] = await db
    .select()
    .from(shopSubscriptions)
    .where(eq(shopSubscriptions.stripeCustomerId, effect.customerId))
    .limit(1);
  if (!row) return "customer_not_found";
  if ("shopIdClaim" in effect && effect.shopIdClaim && effect.shopIdClaim !== row.shopId) {
    return "tenant_mismatch";
  }

  const now = nowDate();
  const sameCustomer = eq(shopSubscriptions.stripeCustomerId, effect.customerId);
  // The live subscription may be replaced only by itself, or once it has
  // ended. A subscription linked but not yet described is live: two Checkout
  // tabs paid in a race make two subscriptions, and the second is refused
  // here and logged for a person to refund rather than silently adopted.
  const mayHoldSubscription = (subscriptionId: string) =>
    or(
      isNull(shopSubscriptions.stripeSubscriptionId),
      eq(shopSubscriptions.stripeSubscriptionId, subscriptionId),
      inArray(shopSubscriptions.stripeStatus, [...ENDED_STATUSES]),
    );

  try {
    switch (effect.kind) {
      case "checkout_completed": {
        const [linked] = await db
          .update(shopSubscriptions)
          .set({
            stripeSubscriptionId: effect.subscriptionId,
            // A new subscription after an ended one starts its own state; the
            // subscription events that follow fill it in.
            ...(row.stripeSubscriptionId !== effect.subscriptionId
              ? {
                  stripeStatus: null,
                  currentPeriodEnd: null,
                  cancelAtPeriodEnd: false,
                  lastSubscriptionEventAt: null,
                }
              : {}),
            updatedAt: now,
          })
          .where(and(sameCustomer, mayHoldSubscription(effect.subscriptionId)))
          .returning({ shopId: shopSubscriptions.shopId });
        return linked ? "linked" : "foreign_subscription";
      }
      case "subscription_changed": {
        const [updated] = await db
          .update(shopSubscriptions)
          .set({
            stripeSubscriptionId: effect.subscriptionId,
            stripeStatus: effect.status,
            currentPeriodEnd: effect.currentPeriodEnd,
            cancelAtPeriodEnd: effect.cancelAtPeriodEnd,
            lastSubscriptionEventAt: effect.occurredAt,
            updatedAt: now,
          })
          .where(
            and(
              sameCustomer,
              mayHoldSubscription(effect.subscriptionId),
              // Ordering applies within one subscription; a new subscription
              // after an ended one starts its own clock.
              or(
                isNull(shopSubscriptions.lastSubscriptionEventAt),
                ne(shopSubscriptions.stripeSubscriptionId, effect.subscriptionId),
                lte(shopSubscriptions.lastSubscriptionEventAt, effect.occurredAt),
              ),
            ),
          )
          .returning({ shopId: shopSubscriptions.shopId });
        if (updated) return "subscription_updated";
        const [current] = await db
          .select({ subscriptionId: shopSubscriptions.stripeSubscriptionId })
          .from(shopSubscriptions)
          .where(sameCustomer)
          .limit(1);
        return current?.subscriptionId === effect.subscriptionId
          ? "stale_event"
          : "foreign_subscription";
      }
      case "invoice_paid": {
        // A $0 invoice — the one Stripe issues when a deferred subscription
        // starts — is not a paid month.
        if (effect.amountPaid <= 0) return "zero_amount";
        const [first] = await db
          .update(shopSubscriptions)
          .set({ firstPaidAt: effect.paidAt, updatedAt: now })
          .where(and(sameCustomer, isNull(shopSubscriptions.firstPaidAt)))
          .returning({ shopId: shopSubscriptions.shopId });
        return first ? "first_paid" : "already_paid";
      }
    }
  } catch (error) {
    // A subscription id another shop's row already holds: the unique index
    // refused it. Retrying cannot change that, so it is answered, not thrown.
    if (isUniqueConstraintViolation(error)) return "subscription_claimed_elsewhere";
    throw error;
  }
}

export type SetFreeTermOutcome =
  | { status: "set"; shopId: string; hasLiveSubscription: boolean }
  | { status: "no_such_shop" }
  | { status: "invalid_date" };

/**
 * Grant (or, with `null`, withdraw) a free term by hand: free through
 * `endsOn`, inclusive, in the shop's own zone.
 *
 * This writes DiveDay's record only. A shop that has already added a card has
 * its first charge date at Stripe, and `hasLiveSubscription` says so, so the
 * person running the command knows to move the trial end there too.
 */
export async function setShopFreeTerm(
  db: AppDb,
  input: { shopSlug: string; endsOn: CalendarDate | null },
): Promise<SetFreeTermOutcome> {
  if (input.endsOn !== null && !isValidCalendarDate(input.endsOn)) {
    return { status: "invalid_date" };
  }
  const [shop] = await db
    .select({ id: shops.id })
    .from(shops)
    .where(eq(shops.slug, input.shopSlug))
    .limit(1);
  if (!shop) return { status: "no_such_shop" };
  const now = nowDate();
  const [row] = await db
    .insert(shopSubscriptions)
    .values({ shopId: shop.id, freeTermEndsOn: input.endsOn, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: shopSubscriptions.shopId,
      set: { freeTermEndsOn: input.endsOn, updatedAt: now },
    })
    .returning();
  const live =
    !!row?.stripeSubscriptionId &&
    row.stripeStatus !== null &&
    !(ENDED_STATUSES as readonly string[]).includes(row.stripeStatus);
  return { status: "set", shopId: shop.id, hasLiveSubscription: live };
}
