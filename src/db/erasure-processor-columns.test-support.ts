import { notificationProcessorColumns } from "@/test/notification-processor-coverage";
import type { ProcessorErasureTarget } from "./schema";

/**
 * Every column the schema could be keeping a **handle to an object an outside
 * system holds** in, and what erasure owes against each.
 *
 * The processor half of erasure is a ledger (`processor_erasure_obligations`,
 * ADR 20260803-processor-erasure-obligations) fed from a list of source
 * columns someone thought to name — and that list was `orders` alone, while
 * `tips` and `booking_checkouts` carried session ids for a person the whole
 * time (issue #1621). That is the same failure mode as the keep-list above:
 * invisible until a person thinks of the table.
 *
 * **The net is cast by role, not by vendor.** It used to be
 * `column.startsWith("stripe_")`, which left this docblock promising more than
 * it checked: a `paypal_payer_id` or a `provider_customer_id` added tomorrow
 * would land in no list and fail no test. Nor was that only a future problem —
 * `booking_payments.provider_ref` and its append-only twin hold the `cs_…`,
 * `in_…` or `re_…` a transition points at, spelled without the vendor's name,
 * and both were already slipping past (a `security-reviewer` pass). So the
 * sweep asks about any free-text column whose name carries an outside-party
 * segment: a vendor's name, a generic `external`/`provider`/`processor`, or a
 * payment-object role such as `customer`, `session`, `invoice` or `payer`.
 * Everything it catches is answered below.
 *
 * **Free text only**, and structurally rather than for convenience: a handle is
 * a string an outside system minted, so it is never an enum (whose values are
 * all ours) and never a `uuid` or an integer (both minted here).
 *
 * **Why a net and not the whole complement.** `OUTSIDE_CLOSURE_REASONS` above
 * can name every table outside the closure because there are 30 of them and a
 * reviewer can read the list. The same move over columns is 1,438 sentences,
 * almost all of them "a timestamp", and a list nobody reads guards nothing. So
 * the limit is stated rather than implied: a handle under a name carrying none
 * of these segments — an `acquiring_bank_token`, say — is invisible here, and a
 * `security-reviewer` pass is what catches it. A whole new *vendor* is not that
 * case, which is the point of casting by role: its columns say `customer`,
 * `session`, `payer`, or the vendor's own name.
 *
 * **What each decision means.**
 *
 * - `person` — held on behalf of one diver, and erasure owes an obligation for
 *   it. The only tag that owes anything, and the only one that names a target.
 * - `shop` — the shop's own furniture at a processor or provider; no diver is
 *   behind the object.
 * - `ledger` — the obligation record's own column, not a source for it.
 * - `copy` — points at an object already censused under the table that owns it.
 *   The obligation is raised there, and raising a second would double-count.
 * - `elsewhere` — an object at a system the ledger deliberately does not reach:
 *   a messaging provider, an accounting integration, the shop's previous
 *   software. Each entry says why, and what happens to the column instead;
 *   ADR 20260803-processor-erasure-obligations, "Widened 2026-10-17".
 * - `none` — the net's over-reach. Caught by a segment, not a handle.
 *
 * A `person` entry must also name the ledger target it raises, and that target
 * must be a value of the enum *and* a target `anonymize.ts` actually builds —
 * because until that was checked, "fails this file on the day it is added" was
 * true of the column's *name* and of nothing else: a new handle could be tagged
 * `person` with a plausible reason, raise no obligation anywhere, and leave
 * this file green (found by a `security-reviewer` pass).
 *
 * It still does **not** prove the erasure raises that obligation *from this
 * column*, for this diver, against that row's own account: the target is
 * matched by name, anywhere in `anonymize.ts`. That is asserted per case in
 * `anonymize.test.ts`, against the write rather than against a name.
 */
export const PROCESSOR_OBJECT_COLUMNS: Record<
  string,
  | { held: "person"; raises: ProcessorErasureTarget; why: string }
  | { held: "shop" | "ledger" | "copy" | "elsewhere" | "none"; why: string }
> = {
  // --- held for one diver: erasure owes an obligation ----------------------
  "orders.stripe_customer_id": {
    held: "person",
    raises: "stripe_customer",
    why: "a `cus_…` created for the diver being billed; deleted through `DELETE /v1/customers/{id}`",
  },
  "orders.stripe_invoice_id": {
    held: "person",
    raises: "stripe_invoice_snapshot",
    why: "a finalized invoice carrying a snapshot of the diver's name and email that no API rewrites; manual, discharged by a human attesting to Stripe's data-deletion request",
  },
  "booking_checkouts.stripe_session_id": {
    held: "person",
    raises: "stripe_checkout_session_snapshot",
    why: "a Checkout Session holding `customer_email` as given and `customer_details` after completion; Stripe can expire a session but never rewrites either, so it is the same manual shape as an invoice snapshot",
  },
  "booking_checkouts.stripe_customer_id": {
    held: "person",
    raises: "stripe_customer",
    why: 'the `cus_…` Stripe minted for that session, recorded so an obligation can name a customer object that actually exists (issue #1621). Null when `customer_creation: "if_required"` created none, and then nothing is owed',
  },

  // --- the shop's own furniture at a processor or provider -----------------
  "orders.stripe_account_id": {
    held: "shop",
    why: "the connected account the order lives on — the shop's, and the scope an obligation is discharged against, never a person's object",
  },
  "booking_checkouts.stripe_account_id": { held: "shop", why: "as orders.stripe_account_id" },
  "shop_subscriptions.stripe_customer_id": {
    held: "shop",
    why: "the shop as DiveDay's own billing customer, on DiveDay's account; no diver is behind it",
  },
  "shop_subscriptions.stripe_subscription_id": { held: "shop", why: "as its stripe_customer_id" },
  "shop_subscriptions.stripe_checkout_session_id": {
    held: "shop",
    why: "the owner's last open Checkout for DiveDay's plan, as shop_subscriptions.stripe_customer_id",
  },
  "pricing_volume_statements.stripe_meter_identifier": { held: "shop", why: "DiveDay's meter key" },
  "shop_stripe_accounts.stripe_account_id": {
    held: "shop",
    why: "the shop's own Connect account. Disconnecting it is a shop decision, not an erasure",
  },
  "deals.stripe_coupon_id": {
    held: "shop",
    why: "a discount the shop published; no diver is behind the object, and the redemption that ties a person to it lives locally and is erased locally",
  },
  "deals.stripe_promotion_code_id": { held: "shop", why: "as stripe_coupon_id above" },
  // Retired by #2720, copied to deals above; dropped next release.
  "shop_promo_codes.stripe_coupon_id": { held: "shop", why: "as deals.stripe_coupon_id" },
  "shop_promo_codes.stripe_promotion_code_id": { held: "shop", why: "as deals.stripe_coupon_id" },
  "trip_last_minute_promos.stripe_coupon_id": { held: "shop", why: "as deals.stripe_coupon_id" },
  "trip_last_minute_promos.stripe_promotion_code_id": {
    held: "shop",
    why: "as deals.stripe_coupon_id",
  },
  "shop_integrations.external_account_id": {
    held: "shop",
    why: "the realm id, Shopify shop id or equivalent for a connection the shop made — its own account at that provider, with no diver behind it",
  },

  // --- the ledger's own columns -------------------------------------------
  "processor_erasure_obligations.stripe_account_id": {
    held: "ledger",
    why: "the obligation row's own scope column — the ledger, not a source for it",
  },
  "processor_erasure_obligations.external_id": {
    held: "ledger",
    why: "the object an obligation is owed against, copied here so a retry still has something to aim at once the source row is redacted. Also the ledger, and also not a source for it",
  },

  // --- a second pointer at an object censused under the table that owns it --
  "payment_operation_intents.stripe_object_id": {
    held: "copy",
    why: "the idempotency ledger's record of which object an attempt produced — a pointer to an object already censused under the table that owns it, never a second one",
  },
  "booking_payment_events.provider_ref": {
    held: "copy",
    why: "whichever object moved this booking's money, spelled without the vendor's name: `booking_checkouts.stripe_session_id`, `orders.stripe_invoice_id`, the `re_…` a refund returned, or a package entitlement id that is at no processor at all. Each is owed against where it is stored, which is why this column raises nothing of its own",
  },
  "orders.stripe_payment_intent_id": {
    held: "copy",
    why: "the PaymentIntent that paid the invoice `orders.stripe_invoice_id` already names; its charge's billing details are the same payment's, discharged by the same manual Stripe deletion request (ADR 20261009-stripe-reversals-reach-diveday)",
  },
  "booking_checkouts.stripe_payment_intent_id": {
    held: "copy",
    why: "the PaymentIntent behind the session `booking_checkouts.stripe_session_id` already names; same discharge as orders.stripe_payment_intent_id",
  },
  "payment_disputes.stripe_payment_intent_id": {
    held: "copy",
    why: "the disputed payment, already censused on the order or checkout the dispute row points at",
  },
  "payment_disputes.stripe_dispute_id": {
    held: "copy",
    why: "Stripe's dispute about a payment already censused on its order or checkout; the evidence and the cardholder's bank details live at Stripe under that payment, and DiveDay stores none of them",
  },
  "payment_disputes.stripe_account_id": { held: "shop", why: "as orders.stripe_account_id" },
  "stripe_payouts.stripe_payout_id": {
    held: "shop",
    why: "the `po_…` of the shop's own transfer to its bank; Stripe holds the shop's balance under it, nothing about a diver",
  },
  "stripe_payouts.stripe_account_id": { held: "shop", why: "as orders.stripe_account_id" },
  "stripe_refund_failures.stripe_refund_id": {
    held: "copy",
    why: "the `re_…` of a refund on a payment already censused on the order or checkout the row points at; Stripe holds nothing under it that the payment does not",
  },
  "stripe_refund_failures.stripe_account_id": { held: "shop", why: "as orders.stripe_account_id" },
  "stripe_refund_failures.refund_status": {
    held: "none",
    why: "Stripe's status word for the refund, `failed` or `canceled`: a state, not a handle on anything",
  },
  "booking_checkouts.checkout_url": {
    held: "copy",
    why: "Stripe's hosted page for the session on this row, and it embeds the `cs_…` it was built from. Expiring that session is what `stripe_session_id` already owes",
  },
  "orders.hosted_invoice_url": {
    held: "copy",
    why: "Stripe's hosted page for the invoice on this row. It renders the diver's name and address, which is precisely what the `stripe_invoice_snapshot` obligation is raised for",
  },
  "orders.invoice_pdf_url": { held: "copy", why: "the same invoice, as a PDF" },

  // --- at a system the obligation ledger deliberately does not reach -------
  ...notificationProcessorColumns,
  "inbound_messages.provider_message_id": {
    held: "elsewhere",
    why: "the provider's handle on a message the *diver* sent in. `body`, `subject` and `from_address` are redacted here; the provider's copy is not reached. `notNull`, so a `wamid.` is rewritten as on notification_deliveries rather than cleared",
  },
  "staff_replies.provider_message_id": {
    held: "elsewhere",
    why: "the provider's handle on the shop's answer to that message, whose body and recipient are redacted here; a `wamid.` is rewritten as on notification_deliveries",
  },
  "waiver_deliveries.provider_message_id": {
    held: "elsewhere",
    why: "the provider's handle on the message carrying a waiver link. `detail` beside it is nulled, a `wamid.` is rewritten as on notification_deliveries, and the sent message is not chased",
  },
  "waiver_records.delivery_provider_message_id": { held: "elsewhere", why: "as above" },
  "email_bounces.provider_message_id": {
    held: "elsewhere",
    why: "SES's id for a message that bounced or drew a complaint. The erasure deletes the row by its recipient address, id and all; the sent message is not chased",
  },
  "integration_sync_records.external_id": {
    held: "elsewhere",
    why: "the QuickBooks object a diver was synced to: the map from a DiveDay row to the provider's own object. The row copies no details, but the Customer it names holds the diver's name and contact details at the provider, and erasure does not reach it. Kept so a second Customer is not created for someone already synced (`OUTSIDE_CLOSURE_REASONS` above, issue #1015). The books are the shop's to keep, and deleting a Customer may not be possible while its invoices reference it. Nothing is owed (ADR)",
  },
  "imported_payment_history.stripe_reference": {
    held: "elsewhere",
    why: "an unverified `in_`/`pi_`/`ch_` a shop carried out of its previous system, kept as a reconciliation seam rather than as an object we hold. Nulled by the erasure, and never chased at an account it may not even belong to",
  },
  "imported_payment_history.payment_reference": {
    held: "elsewhere",
    why: "the previous system's own identifier for that payment. DiveDay has no connection to that system and could not discharge anything there; the column is nulled instead",
  },
  "imported_payment_history.receipt_reference": {
    held: "elsewhere",
    why: "the previous system's receipt number, nulled for the reason above",
  },
  "imported_payment_history.source_reference": {
    held: "elsewhere",
    why: "the previous system's booking or order id beside it, nulled with the rest of the row",
  },
  "prior_visits.source_reference": {
    held: "elsewhere",
    why: "the previous system's booking id for an imported visit; nulled, along with the `dedupe_key` that can embed it",
  },
  "prior_gear_assignments.source_reference": {
    held: "elsewhere",
    why: "the same handle on imported rental history, nulled the same way",
  },

  // --- the net's over-reach: caught by a segment, not a handle -------------
  "booking_checkouts.customer_email": {
    held: "none",
    why: "the address the diver gave at checkout. Personal data rather than a handle on anything, and redacted with the rest of the row",
  },
  "notification_deliveries.provider_detail": {
    held: "none",
    why: "the provider's own words for a bounce, which quote the address back often enough that the erasure nulls them. A sentence, not a handle",
  },
  "imported_payment_history.receipt_document_url": {
    held: "none",
    why: "a receipt document re-stored in our own bucket — the source system's raw URL is never kept. The blob is retired through the media-deletion ledger and the column nulled",
  },
  "shop_integrations.external_label": {
    held: "none",
    why: "a display label for the connection, which the schema already states is never a token or a URL secret",
  },
  "booking_payment_events.provider": {
    held: "none",
    why: '"stripe", or null for a manual mark: which system moved the money, not a handle on anything it holds',
  },
  "inbound_messages.assist_intent": {
    held: "none",
    why: "Claude's code for what a message asks (cancel, move, question…): a tag from a fixed list, not a handle on anything",
  },
  "auth_provider_accounts.provider_id": {
    held: "none",
    why: "better-auth's name for a login provider, on a table no sign-in path in this repo writes. A provider's *name*, and no payment anywhere near it",
  },
};
