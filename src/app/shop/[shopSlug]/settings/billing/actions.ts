"use server";
import { redirect } from "next/navigation";
import { canPersonManageBilling } from "@/db/authz";
import { getDb } from "@/db/client";
import {
  ensureShopBillingCustomer,
  getShopSubscription,
  holdsLiveSubscription,
  recordShopCheckoutSession,
} from "@/db/shop-subscriptions";
import { getShopById } from "@/db/shops";
import { freeTimeEndsAt } from "@/lib/billing/standing";
import { billingProviderFromEnvironment } from "@/lib/billing/stripe-billing";
import { nowDate } from "@/lib/clock";
import { publicAppUrl } from "@/lib/notifications";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { trialEndsAt } from "@/lib/trial";

/**
 * The two doors out to Stripe from Settings > Billing (ADR
 * 20261007-subscription-billing): Checkout to add a card, the Customer Portal
 * to change it, read invoices, or cancel.
 *
 * Neither writes subscription state. Checkout's success redirect only says
 * "you came back"; what the shop's subscription *is* arrives by webhook, which
 * is why the page reads the row and never the redirect.
 *
 * Every refusal is a redirect with a code, decided before Stripe is asked
 * anything: the live owner gate first, then a demo shop (never billed), then
 * whether billing is configured at all.
 */

/** Codes the Billing page answers (`billingNoticeMessages`, `../sub-page-notices.ts`). */
export type BillingNotice = "not-configured" | "unavailable" | "demo" | "card-added" | "pending";

type BillingContext = {
  slug: string;
  shopId: string;
  shopName: string;
  email: string;
  isDemo: boolean;
  timezone: string;
  createdAt: Date;
};

/**
 * The owner gate, re-read from live roles on every call — a server action can
 * be invoked without its page, so the page having rendered proves nothing.
 * The shop is the session's own, never one named by the form.
 */
async function requireBillingOwner(): Promise<BillingContext> {
  const session = await requireStaffSession();
  const db = await getDb();
  const allowed = await canPersonManageBilling(db, session.user.shopId, session.user.personId);
  if (!allowed) {
    redirect(noticeUrl(shopPath(session.user.shopSlug), "billing-not-authorized"));
  }
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) redirect(noticeUrl(shopPath(session.user.shopSlug), "billing-not-authorized"));
  return {
    slug: shop.slug,
    shopId: shop.id,
    shopName: shop.name,
    email: session.user.email,
    isDemo: shop.isDemo,
    timezone: shop.timezone,
    createdAt: shop.createdAt,
  };
}

function billingPath(slug: string): string {
  return shopPath(slug, "settings", "billing");
}

function refuse(slug: string, notice: BillingNotice): never {
  redirect(noticeUrl(billingPath(slug), notice));
}

/**
 * "Add a card": mint (or reuse) the shop's Stripe Customer, then open
 * Checkout for the one price, with the first charge deferred to the end of
 * whatever free time the shop has left.
 *
 * Two guards keep a shop to one subscription, both decided on the row rather
 * than on the standing the page shows:
 *
 * - A shop whose row holds a subscription that has not ended — including one
 *   Checkout linked whose status has not arrived, and one still `incomplete` —
 *   is sent to the Portal instead.
 * - The Checkout session opened last is settled at Stripe before another
 *   opens: expired if still open (a second tab), and a refusal ("pending")
 *   if it already completed but its webhook has not landed. The new session
 *   is then recorded only if no other tab recorded one in between.
 */
export async function startBillingCheckoutAction(): Promise<void> {
  const context = await requireBillingOwner();
  if (context.isDemo) refuse(context.slug, "demo");
  const provider = billingProviderFromEnvironment();
  const origin = publicAppUrl();
  if (!provider || !origin) refuse(context.slug, "not-configured");

  const db = await getDb();
  const row = await getShopSubscription(db, context.shopId);
  const returnUrl = `${origin}${billingPath(context.slug)}`;

  if (row?.stripeCustomerId && holdsLiveSubscription(row)) {
    const portal = await provider.createPortalSession({
      customerId: row.stripeCustomerId,
      returnUrl,
    });
    if (portal.status !== "ok") refuse(context.slug, "unavailable");
    redirect(portal.value);
  }

  let customerId = row?.stripeCustomerId ?? null;
  if (!customerId) {
    const created = await provider.createCustomer({
      shopId: context.shopId,
      shopName: context.shopName,
      email: context.email,
    });
    if (created.status !== "ok") refuse(context.slug, "unavailable");
    customerId = await ensureShopBillingCustomer(db, context.shopId, created.value);
    if (!customerId) refuse(context.slug, "unavailable");
  }

  const previous = row?.stripeCheckoutSessionId ?? null;
  if (previous) {
    const settled = await provider.settleCheckoutSession(previous);
    if (settled.status !== "ok") refuse(context.slug, "unavailable");
    if (settled.value === "completed") refuse(context.slug, "pending");
  }

  const now = nowDate();
  const checkout = await provider.createCheckoutSession({
    shopId: context.shopId,
    customerId,
    successUrl: `${origin}${noticeUrl(billingPath(context.slug), "card-added")}`,
    cancelUrl: returnUrl,
    firstChargeAt: freeTimeEndsAt({
      now,
      timeZone: context.timezone,
      trialEndsAt: trialEndsAt(context.createdAt),
      freeTermEndsOn: row?.freeTermEndsOn ?? null,
    }),
    now,
  });
  if (checkout.status !== "ok") refuse(context.slug, "unavailable");
  const recorded = await recordShopCheckoutSession(db, context.shopId, {
    previous,
    sessionId: checkout.value.id,
  });
  if (!recorded) {
    // Another tab opened its own session in between: this one must never be paid.
    await provider.settleCheckoutSession(checkout.value.id);
    refuse(context.slug, "unavailable");
  }
  redirect(checkout.value.url);
}

/**
 * "Manage billing" and "Cancel plan": the Customer Portal, either at its front
 * door or opened straight on the cancel confirmation for the shop's live
 * subscription. The subscription id comes from the shop's own row, never from
 * the form, so a crafted post cannot aim the cancel flow at anything else.
 */
export async function openBillingPortalAction(formData: FormData): Promise<void> {
  const context = await requireBillingOwner();
  if (context.isDemo) refuse(context.slug, "demo");
  const provider = billingProviderFromEnvironment();
  const origin = publicAppUrl();
  if (!provider || !origin) refuse(context.slug, "not-configured");

  const db = await getDb();
  const row = await getShopSubscription(db, context.shopId);
  if (!row?.stripeCustomerId) refuse(context.slug, "unavailable");

  const wantsCancel = formData.get("intent") === "cancel";
  const cancelSubscriptionId =
    wantsCancel && row.stripeSubscriptionId ? row.stripeSubscriptionId : undefined;
  const portal = await provider.createPortalSession({
    customerId: row.stripeCustomerId,
    returnUrl: `${origin}${billingPath(context.slug)}`,
    cancelSubscriptionId,
  });
  if (portal.status !== "ok") refuse(context.slug, "unavailable");
  redirect(portal.value);
}
