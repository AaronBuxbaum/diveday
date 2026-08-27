"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { canPersonManageOrders } from "@/db/authz";
import { getDb } from "@/db/client";
import { createOrder, type NewOrderLineItem } from "@/db/orders";
import { orderLineItemKind } from "@/db/schema";
import { getShopCurrency, getShopTaxEnabled } from "@/db/stripe-accounts";
import { majorToMinor } from "@/lib/money";
import { revalidateAndRedirect } from "@/lib/navigation";
import {
  type InvoiceCustomerAddress,
  isUsableInvoiceCustomerAddress,
} from "@/lib/payments/invoicing";
import { hasRequiredStepUp, stepUpChallengeUrl } from "@/lib/security-step-up";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { LINE_ITEM_ROWS } from "./order-form";

// Bounds match the house convention for a bounded dollar-to-cents amount
// (courses edit action: .max(100_000)) and an explicit integer quantity
// range (trip capacity/party-size actions: .int().min().max()) — CR-016.
const dollarsSchema = z.coerce.number().nonnegative().max(100_000);
const quantitySchema = z.coerce.number().int().min(1).max(100);
const lineDescriptionSchema = z.string().trim().min(1).max(200);
// The ids are uuid columns: without this, a crafted post reaches Postgres as
// a 22P02 cast error (an unhandled 500) instead of the invalid-notice redirect
// every other bad input gets. Same 200-char bound the line items carry, at
// both layers (createOrder re-checks) — the client maxLength is advisory.
const personIdSchema = z.string().uuid();
const bookingIdSchema = z.string().uuid().nullable();
const orderDescriptionSchema = z.string().trim().max(200);
// Sourced from the pg enum, not a hand-typed literal list, so it can never
// drift from what the database will actually accept.
const lineItemKindSchema = z.enum(orderLineItemKind.enumValues);
const customerAddressSchema = z.object({
  line1: z.string().trim().max(200),
  line2: z.string().trim().max(200),
  city: z.string().trim().max(100),
  state: z.string().trim().max(100),
  postalCode: z.string().trim().max(30),
  country: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/)
    .transform((value) => value.toUpperCase()),
});

/**
 * Raise an invoice for a diver.
 *
 * A page's own module rather than an inline `"use server"` closure (AGENTS.md
 * layout rule for a large page) so the gate below is reachable by a test: an
 * inline closure can only be exercised through the page that renders it, which
 * is exactly the layer a POST straight at the action skips.
 * See `./actions.authz.test.ts` and ADR 20260803-invoicing-role-gate.
 */
export async function createOrderAction(formData: FormData) {
  const session = await requireStaffSession();
  const db = await getDb();
  // `shopPath`, not a template: the slug rides in on the session but is still
  // an ordinary string being spliced into a redirect target, and every segment
  // it builds is escaped (src/lib/staff-notices.ts).
  const orders = shopPath(session.user.shopSlug, "orders");
  const newOrder = shopPath(session.user.shopSlug, "orders", "new");
  // Billing a diver is owner/manager work (H-14, ADR 20260724-role-authorization):
  // an invoice goes out with the shop's name on it, on the shop's own connected
  // Stripe account, and lands in the shop's books. Re-checked against live roles
  // here, not just hidden from the page — a form post from a captain's browser
  // reaches this action regardless of what was rendered (ADR-0006). The landing
  // is the Orders index with the reason, the same door this page's other refusal
  // uses: a captain can still read orders, so bouncing them to Today would be
  // further than the refusal warrants.
  if (!(await canPersonManageOrders(db, session.user.shopId, session.user.personId))) {
    revalidateAndRedirect(orders, noticeUrl(orders, "not-authorized"));
  }
  if (!(await hasRequiredStepUp(db, session, "money"))) {
    redirect(stepUpChallengeUrl(session.user.shopSlug, "money", newOrder));
  }

  const parsedPersonId = personIdSchema.safeParse(String(formData.get("personId") ?? ""));
  const parsedBookingId = bookingIdSchema.safeParse(
    String(formData.get("bookingId") ?? "").trim() || null,
  );
  const parsedDescription = orderDescriptionSchema.safeParse(
    String(formData.get("description") ?? ""),
  );
  if (!parsedPersonId.success || !parsedBookingId.success || !parsedDescription.success) {
    redirect(noticeUrl(newOrder, "invalid"));
  }
  const personId = parsedPersonId.data;
  const bookingId = parsedBookingId.data;
  const description = parsedDescription.data || null;

  // Staff type a major-unit price ("129.00"); the invoice is billed in an
  // integer count of the shop currency's minor unit. The multiplier is the
  // currency's own, never a literal 100 — ¥5000 typed is 5000 stored, not
  // 500000 (docs ADR 20260731-shop-currency). `createOrder` reads the same
  // shop setting for the invoice itself, so the two can't disagree.
  const currency = await getShopCurrency(db, session.user.shopId);
  const taxEnabled = await getShopTaxEnabled(db, session.user.shopId);
  let customerAddress: InvoiceCustomerAddress | undefined;
  if (taxEnabled) {
    const parsedAddress = customerAddressSchema.safeParse({
      line1: String(formData.get("customerAddressLine1") ?? ""),
      line2: String(formData.get("customerAddressLine2") ?? ""),
      city: String(formData.get("customerAddressCity") ?? ""),
      state: String(formData.get("customerAddressRegion") ?? ""),
      postalCode: String(formData.get("customerAddressPostalCode") ?? ""),
      country: String(formData.get("customerAddressCountry") ?? ""),
    });
    if (!parsedAddress.success || !isUsableInvoiceCustomerAddress(parsedAddress.data)) {
      redirect(noticeUrl(newOrder, "tax-location-required"));
    }
    customerAddress = parsedAddress.data;
  }

  const lineItems: NewOrderLineItem[] = [];
  for (let i = 0; i < LINE_ITEM_ROWS; i++) {
    const rawDescription = String(formData.get(`description-${i}`) ?? "").trim();
    if (!rawDescription) continue;
    const itemDescription = lineDescriptionSchema.safeParse(rawDescription);
    const kind = lineItemKindSchema.safeParse(formData.get(`kind-${i}`));
    const quantity = quantitySchema.safeParse(formData.get(`quantity-${i}`) ?? "1");
    const dollars = dollarsSchema.safeParse(formData.get(`unitAmount-${i}`));
    // A filled-in row with an out-of-bounds value fails the whole submission
    // rather than silently dropping the row — a staff member who typed four
    // line items should never end up with a three-line invoice unexplained.
    if (!itemDescription.success || !kind.success || !quantity.success || !dollars.success) {
      redirect(noticeUrl(newOrder, "invalid"));
    }
    lineItems.push({
      kind: kind.data,
      description: itemDescription.data,
      quantity: quantity.data,
      unitAmountCents: majorToMinor(dollars.data, currency),
    });
  }

  if (!personId || lineItems.length === 0) {
    redirect(noticeUrl(newOrder, "invalid"));
  }

  const result = await createOrder(db, {
    shopId: session.user.shopId,
    personId,
    createdByPersonId: session.user.personId,
    bookingId,
    description,
    customerAddress,
    lineItems,
  });

  if (!result.ok) {
    // Every reason lands back on the form with the reason, including the
    // `not_authorized` `createOrder` raises when its own live-role check refuses
    // a submission the gate above admitted (roles changed mid-flight): the page
    // that form lives on runs the same check on render, so it re-lands them on
    // Orders with the explanation. No special case needed here.
    //
    // `createOrder` answers in its own domain casing (`not_authorized`,
    // `not_connected`, `stripe_failed`); `noticeUrl` normalises that to the one
    // kebab spelling the page's `NOTICE_KEYS` holds, so this passes the reason
    // straight through rather than hand-translating it.
    redirect(noticeUrl(newOrder, result.reason));
  }
  revalidateAndRedirect(orders, `${orders}/${result.order.id}`);
}
