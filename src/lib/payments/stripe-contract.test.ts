import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { nowMs } from "../clock";
import {
  STRIPE_EVENT_FIXTURES,
  stripeEventFixture,
  stripeEventFixtureRaw,
  stripeObjectFixture,
} from "./__fixtures__/stripe";
import { checkoutProviderFromEnvironment } from "./checkout";
import { connectProviderFromEnvironment } from "./connect";
import { customerProviderFromEnvironment } from "./customers";
import { invoicingProviderFromEnvironment } from "./invoicing";
import { promotionProviderFromEnvironment } from "./promotions";
import { allocateSettledTotal, netOfPercentDiscount } from "./settlement";
import { verifyStripeWebhook } from "./webhook";

/**
 * The contract half of the payments tests (TEST-M2).
 *
 * Every *other* test in this directory injects a fake `fetch` and hands the
 * provider a body the test wrote itself, so it can only ever prove the code
 * agrees with the test author. This file hands the same production parsers
 * **real-shaped Stripe payloads** (`./__fixtures__/stripe/`, pinned to one API
 * version) and asserts what they make of them. A field Stripe moved, renamed,
 * or removed fails here — which is the whole point, since it currently fails
 * nowhere else.
 *
 * Read `./__fixtures__/stripe/README.md` first: the payloads are hand-authored
 * from Stripe's published object references, correct in shape and invented in
 * value.
 */

const ENV = { STRIPE_SECRET_KEY: "sk_test_fixture", STRIPE_CONNECT_CLIENT_ID: "ca_test_fixture" };

/** A `fetch` that answers each call, in order, with a fixture. */
function fetchReturning(...responses: Array<{ ok?: boolean; status?: number; body: unknown }>) {
  const impl = vi.fn();
  for (const { ok = true, status = ok ? 200 : 400, body } of responses) {
    impl.mockResolvedValueOnce({ ok, status, json: async () => body });
  }
  return impl as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// Webhook envelope
// ---------------------------------------------------------------------------

describe("verifyStripeWebhook accepts every real event this app handles", () => {
  const secret = "whsec_fixture";

  function sign(payload: string) {
    const timestamp = Math.floor(nowMs() / 1000);
    const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
    return `t=${timestamp},v1=${signature}`;
  }

  for (const name of STRIPE_EVENT_FIXTURES) {
    it(`verifies and parses ${name}`, () => {
      // The raw bytes, not a re-serialisation: Stripe signs the body it sent,
      // so a test that stringifies a parsed object is testing its own
      // JSON.stringify rather than the payload.
      const raw = stripeEventFixtureRaw(name);
      const result = verifyStripeWebhook(raw, sign(raw), secret);

      expect(result.status).toBe("verified");
      if (result.status !== "verified") return;

      const fixture = stripeEventFixture(name);
      expect(result.event.type).toBe(name);
      expect(result.event.id).toBe(fixture.id);
      // Every field the schema declares optional "so a hand-built fixture still
      // parses" is present on a *real* event, and the route's behaviour hangs
      // on all three: `account` routes the write, `created` orders two
      // deliveries, `livemode` is cross-checked against the signing secret.
      expect(result.event.account).toBe("acct_1Nv0FGQ9RKHgCVdK");
      expect(result.event.created).toBe(fixture.created);
      expect(result.event.livemode).toBe(false);
      expect(result.event.data.object).toBeTypeOf("object");
    });
  }

  it("still refuses a real event whose body was edited after signing", () => {
    const raw = stripeEventFixtureRaw("invoice.paid");
    const header = sign(raw);
    const tampered = raw.replace("in_1QsAVeLkdIwHu7ixKmNpQrSt", "in_attackers_own_invoice");
    // Guard the guard: if that id is ever renamed in the fixture, `replace` is a
    // silent no-op, `tampered` is the signed payload, and this test would assert
    // that an *untouched* body verifies — passing forever while proving nothing.
    expect(tampered, "the tampered payload must actually differ from the signed one").not.toBe(raw);
    expect(verifyStripeWebhook(tampered, header, secret)).toEqual({ status: "invalid_signature" });
  });
});

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

describe("checkout provider against real Checkout Session payloads", () => {
  const request = {
    stripeAccountId: "acct_1Nv0FGQ9RKHgCVdK",
    currency: "usd",
    lineItems: [{ description: "Two-Tank Reef Charter", unitAmountCents: 18_000, quantity: 2 }],
    customerEmail: "priya@example.com",
    successUrl: "https://diveday.app/s/blue-mantis/trips/trip_1?checkout=success",
    cancelUrl: "https://diveday.app/s/blue-mantis/trips/trip_1?checkout=cancelled",
    idempotencyKey: "intent-1",
  };

  it("reads a freshly created session's own fields, not invented ones", async () => {
    const session = stripeObjectFixture("checkout-session.open");
    const provider = checkoutProviderFromEnvironment(ENV, fetchReturning({ body: session }));

    expect(await provider.createCheckoutSession(request)).toEqual({
      status: "created",
      stripeSessionId: session.id,
      stripeStatus: "open",
      paymentStatus: "unpaid",
      checkoutUrl: session.url,
      amountTotalCents: 36_000,
      taxAmountCents: 0,
      expiresAt: new Date(1_784_727_000 * 1000),
    });
  });

  it("takes the settled total from Stripe's amount_total, after the discount it applied", async () => {
    // The fixture's asked-for subtotal is 36000 and its `amount_total` is
    // 32400 — a 10% promotion code Stripe priced itself. Reading the wrong one
    // is what over-refunds a party member (PAY-H1/H2), so pin which field wins.
    const provider = checkoutProviderFromEnvironment(
      ENV,
      fetchReturning({
        body: stripeObjectFixture("checkout-session.paid-expanded-payment-intent"),
      }),
    );

    const result = await provider.retrieveCheckoutSession("acct_1Nv0FGQ9RKHgCVdK", "cs_test_a1H7");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.session.amountTotalCents).toBe(32_400);
    expect(result.session.paymentStatus).toBe("paid");
    expect(result.session.stripeStatus).toBe("complete");
    // A completed session has no payable URL left; "no link", never a stale one.
    expect(result.session.checkoutUrl).toBeNull();
  });

  it("finds the payment intent inside a real expanded session and refunds against it", async () => {
    // `?expand[]=payment_intent` on a Checkout Session returns the whole
    // PaymentIntent object, not an id — the union in `sessionResponseSchema`
    // exists for exactly this, and this is the payload that proves it.
    const fetchImpl = fetchReturning(
      { body: stripeObjectFixture("checkout-session.paid-expanded-payment-intent") },
      { body: stripeObjectFixture("refund") },
    );
    const provider = checkoutProviderFromEnvironment(ENV, fetchImpl);

    expect(
      await provider.refundCheckoutSession(
        "acct_1Nv0FGQ9RKHgCVdK",
        "cs_test_a1H7",
        "intent-refund-1",
        12_000,
      ),
    ).toEqual({ status: "refunded", refundId: "re_3QsAVgLkdIwHu7ix1KpQrStU" });

    const refundCall = vi.mocked(fetchImpl).mock.calls[1]?.[1] as { body: string };
    const form = new URLSearchParams(refundCall.body);
    expect(form.get("payment_intent")).toBe("pi_3QsAVgLkdIwHu7ix1YtNqW9K");
    expect(form.get("amount")).toBe("12000");
  });

  it("reads an unexpanded payment_intent — the string arm of the union, as a webhook sends it", async () => {
    // The retrieve-with-`?expand[]` path gets the whole PaymentIntent object;
    // a webhook's own session object carries the bare id string. Both arms of
    // `sessionResponseSchema`'s union are live in production and only the
    // object one was covered. This drives the string one with the exact session
    // Stripe puts inside `checkout.session.completed`, so code that ever
    // assumed the object shape refunds nothing here instead of in a shop.
    const webhookSession = (
      stripeEventFixture("checkout.session.completed").data as {
        object: Record<string, unknown>;
      }
    ).object;
    expect(webhookSession.payment_intent).toBeTypeOf("string");

    const fetchImpl = fetchReturning(
      { body: webhookSession },
      { body: stripeObjectFixture("refund") },
    );
    const provider = checkoutProviderFromEnvironment(ENV, fetchImpl);

    expect(
      await provider.refundCheckoutSession("acct_1Nv0FGQ9RKHgCVdK", "cs_test_a1H7", "intent-r2"),
    ).toEqual({ status: "refunded", refundId: "re_3QsAVgLkdIwHu7ix1KpQrStU" });

    const refundCall = vi.mocked(fetchImpl).mock.calls[1]?.[1] as { body: string };
    const form = new URLSearchParams(refundCall.body);
    expect(form.get("payment_intent")).toBe("pi_3QsAVgLkdIwHu7ix1YtNqW9K");
    // No `amount` — an omitted amountCents must refund in full, not zero.
    expect(form.get("amount")).toBeNull();
  });

  it("refuses to refund an open session, which has no payment intent at all", async () => {
    // The real un-paid session carries `payment_intent: null`. `not_refundable`
    // is the honest answer; a crash or a "refunded" here would be worse.
    const provider = checkoutProviderFromEnvironment(
      ENV,
      fetchReturning({ body: stripeObjectFixture("checkout-session.open") }),
    );
    expect(
      await provider.refundCheckoutSession("acct_1Nv0FGQ9RKHgCVdK", "cs_test_a1H7", "intent-r3"),
    ).toEqual({ status: "not_refundable" });
  });
});

// ---------------------------------------------------------------------------
// Settlement — the real settled total, split across a party's ledger rows
// ---------------------------------------------------------------------------

describe("the settled total Stripe reports is what the per-booking ledger splits", () => {
  /**
   * `settlement.ts` is pure arithmetic with no Stripe call of its own, so it has
   * no payload to pin — but it is the code that decides *how much of a real
   * Stripe payment each diver is recorded as having paid*, and therefore how
   * much a later cancellation reverses. The number it must be fed is Stripe's
   * `amount_total`, after any discount Stripe applied. Taking that figure off
   * the fixture rather than typing it here is what makes this a contract test:
   * if the field ever moves, this stops agreeing with the payload.
   */
  const settledTotal = stripeObjectFixture("checkout-session.paid-expanded-payment-intent")
    .amount_total as number;
  const askedSubtotal = stripeObjectFixture("checkout-session.paid-expanded-payment-intent")
    .amount_subtotal as number;

  it("splits a real discounted party total to exactly the cents Stripe collected", () => {
    // Two divers, each asked 18000 of the 36000 subtotal; Stripe collected
    // 32400 after a 10% code. Neither diver may be recorded above their share.
    const allocation = allocateSettledTotal(
      [
        { key: "booking-a", askedCents: 18_000 },
        { key: "booking-b", askedCents: 18_000 },
      ],
      settledTotal,
    );

    expect([...allocation.values()].reduce((sum, cents) => sum + cents, 0)).toBe(settledTotal);
    expect(allocation.get("booking-a")).toBe(16_200);
    expect(allocation.get("booking-b")).toBe(16_200);
  });

  it("invents no cent and drops none when the real total will not divide evenly", () => {
    // Three divers against the same real 32400: 10800 each is exact, so nudge
    // the party to an uneven ask and prove the largest-remainder split still
    // sums to Stripe's figure to the cent.
    const allocation = allocateSettledTotal(
      [
        { key: "booking-a", askedCents: 12_000 },
        { key: "booking-b", askedCents: 12_000 },
        { key: "booking-c", askedCents: 11_999 },
      ],
      settledTotal,
    );
    expect([...allocation.values()].reduce((sum, cents) => sum + cents, 0)).toBe(settledTotal);
    // Precondition of the split: no share exceeds what that booking was asked.
    expect(allocation.get("booking-a")).toBeLessThanOrEqual(12_000);
    expect(allocation.get("booking-c")).toBeLessThanOrEqual(11_999);
  });

  it("estimates the same total from the discount percent when Stripe reports none", () => {
    // The PAY-M3 fallback path: no `amount_total` on the payload, so the code
    // works the settled figure out from the asked subtotal and the percent.
    // The fixture's own discount (3600 of 36000) is exactly 10%, which is what
    // makes it checkable against the real numbers rather than invented ones.
    const discount = (
      stripeObjectFixture("checkout-session.paid-expanded-payment-intent").total_details as {
        amount_discount: number;
      }
    ).amount_discount;
    expect(discount).toBe(askedSubtotal - settledTotal);
    expect(netOfPercentDiscount(askedSubtotal, 10)).toBe(settledTotal);
  });
});

// ---------------------------------------------------------------------------
// Invoicing — including the field Stripe removed
// ---------------------------------------------------------------------------

describe("invoicing provider against real Invoice payloads", () => {
  it("builds an invoice from the real customer and invoice objects", async () => {
    const invoice = stripeObjectFixture("invoice.open");
    const provider = invoicingProviderFromEnvironment(
      ENV,
      // customer, invoiceitem, invoice, finalize, send
      fetchReturning(
        { body: stripeObjectFixture("customer") },
        { body: { id: "ii_1QsAVdLkdIwHu7ixWxYzAb2C", object: "invoiceitem" } },
        { body: invoice },
        { body: invoice },
        { body: invoice },
      ),
    );

    expect(
      await provider.createInvoice({
        stripeAccountId: "acct_1Nv0FGQ9RKHgCVdK",
        customerEmail: "priya@example.com",
        customerName: "Priya Raman",
        currency: "usd",
        lineItems: [{ description: "Two-Tank Reef Charter", quantity: 2, unitAmountCents: 12_000 }],
        idempotencyKey: "intent-1",
      }),
    ).toEqual({
      status: "created",
      stripeCustomerId: "cus_TQd8mKp2VnRxLa",
      stripeInvoiceId: invoice.id,
      stripeStatus: "open",
      hostedInvoiceUrl: invoice.hosted_invoice_url,
      invoicePdfUrl: invoice.invoice_pdf,
      totalCents: 24_000,
      taxCents: 0,
    });
  });

  it("reads a paid invoice's own amounts back", async () => {
    const provider = invoicingProviderFromEnvironment(
      ENV,
      fetchReturning({ body: stripeObjectFixture("invoice.paid") }),
    );

    const result = await provider.retrieveInvoice("acct_1Nv0FGQ9RKHgCVdK", "in_1QsAVe");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.invoice.status).toBe("paid");
    expect(result.invoice.amountPaidCents).toBe(24_000);
    expect(result.invoice.totalCents).toBe(24_000);
    expect(result.invoice.taxCents).toBe(0);
  });

  /**
   * **The finding this whole fixture set exists to surface.**
   *
   * `refundInvoice` retrieves the invoice with `?expand[]=payment_intent` and
   * reverses `invoice.payment_intent`. Stripe **removed that field from the
   * Invoice object** in the Basil release (`2025-03-31.basil`), replacing it
   * with the `payments` list of `InvoicePayment` objects (and
   * `confirmation_secret` for the client secret). Every hand-written payload in
   * `invoicing.test.ts` still carries `payment_intent`, so every one of those
   * tests passes.
   *
   * Against the shape Stripe actually returns today there is no payment intent
   * to find, so the provider reports `not_refundable` — and `refundOrder`
   * (src/db/orders.ts) reads any non-`refunded` status as a failed operation,
   * marks the payment operation failed and returns null. A staff member asks
   * for a refund on an invoiced order and no money moves.
   *
   * These two tests characterise the current behaviour rather than assert the
   * desired behaviour: they are green today, and they are the regression net
   * for the fix. The payment intent has to come from
   * `invoice.payments.data[].payment.payment_intent`.
   */
  /**
   * These two cases are the reason this file exists.
   *
   * Written first as a *reproduction*: against a real current Invoice payload,
   * `refundInvoice` answered `not_refundable` and moved no money, while every
   * hand-written payload in `invoicing.test.ts` — all of them carrying a flat
   * `payment_intent` Stripe has since removed — stayed green. Now written as
   * the regression: the money is found where a current account actually puts
   * it, and the request that Stripe rejects outright is no longer sent.
   */
  describe("refundInvoice against a current Invoice object", () => {
    it("finds the payment intent in the invoice-payments list, not the removed flat field", async () => {
      const invoice = stripeObjectFixture("invoice.paid");
      // The money is in the payments list; the flat field is simply gone.
      expect(invoice.payment_intent).toBeUndefined();
      expect(
        (invoice.payments as { data: { payment: { payment_intent: string } }[] }).data[0]?.payment
          .payment_intent,
      ).toBe("pi_3QsAVfLkdIwHu7ix0PqRsT1U");

      const fetchImpl = fetchReturning(
        { body: invoice },
        { body: { id: "re_1QsAVhLkdIwHu7ixRefund01" } },
      );
      const provider = invoicingProviderFromEnvironment(ENV, fetchImpl);

      expect(
        await provider.refundInvoice("acct_1Nv0FGQ9RKHgCVdK", "in_1QsAVe", "intent-refund-1"),
      ).toEqual({ status: "refunded", refundId: "re_1QsAVhLkdIwHu7ixRefund01" });

      // Two calls: the retrieve, then the refund it can now actually make.
      expect(vi.mocked(fetchImpl)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(fetchImpl).mock.calls[1][1]?.body).toContain(
        "payment_intent=pi_3QsAVfLkdIwHu7ix0PqRsT1U",
      );
    });

    it("sends an `amount` only when one is asked for, and reads Stripe's own figure back", async () => {
      // The partial-refund contract (issue #699), the same shape
      // `refundCheckoutSession` has had all along. An omitted amount must
      // refund in FULL, not zero — Stripe reads an absent `amount` as "all of
      // it", and spelling the full figure out instead would be a different
      // request it can reject on a rounding disagreement.
      const invoice = stripeObjectFixture("invoice.paid");
      const refund = stripeObjectFixture("refund");

      const partial = fetchReturning({ body: invoice }, { body: { ...refund, amount: 5_000 } });
      expect(
        await invoicingProviderFromEnvironment(ENV, partial).refundInvoice(
          "acct_1Nv0FGQ9RKHgCVdK",
          "in_1QsAVe",
          "intent-refund-partial",
          5_000,
        ),
      ).toEqual({ status: "refunded", refundId: refund.id, amountCents: 5_000 });
      const partialCall = vi.mocked(partial).mock.calls[1]?.[1] as { body: string };
      const partialForm = new URLSearchParams(partialCall.body);
      expect(partialForm.get("amount")).toBe("5000");

      const full = fetchReturning({ body: invoice }, { body: refund });
      await invoicingProviderFromEnvironment(ENV, full).refundInvoice(
        "acct_1Nv0FGQ9RKHgCVdK",
        "in_1QsAVe",
        "intent-refund-full",
      );
      const fullCall = vi.mocked(full).mock.calls[1]?.[1] as { body: string };
      const fullForm = new URLSearchParams(fullCall.body);
      expect(fullForm.get("amount")).toBeNull();
    });

    it("refuses a refund amount that is not a whole, non-negative count of minor units", async () => {
      // `amountCents` becomes the `reverseCents` delta the ledger applies, so a
      // negative one subtracts through the clamp — *raising* `amount_paid_cents`
      // above what the order ever held and *lowering* `refunded_cents` — and a
      // fractional one writes a non-integer into an integer column. Failing the
      // parse puts a malformed response on `failed`, where a caller can see it
      // (CodeRabbit review on PR #949).
      const invoice = stripeObjectFixture("invoice.paid");
      const refund = stripeObjectFixture("refund");
      for (const amount of [-5_000, 12.5]) {
        const fetchImpl = fetchReturning({ body: invoice }, { body: { ...refund, amount } });
        expect(
          await invoicingProviderFromEnvironment(ENV, fetchImpl).refundInvoice(
            "acct_1Nv0FGQ9RKHgCVdK",
            "in_1QsAVe",
            `intent-refund-${amount}`,
            5_000,
          ),
        ).toEqual({ status: "failed" });
      }
    });

    it("never asks Stripe to expand the field it no longer has", async () => {
      // Stripe answers 400 `parameter_unknown` for `expand[]=payment_intent`
      // rather than ignoring it, so sending that parameter did not merely
      // waste a round trip — it failed the whole retrieve, and with it the
      // refund. The fixture is that error; the assertion is that the request
      // which provokes it is never made.
      const fetchImpl = fetchReturning(
        { body: stripeObjectFixture("invoice.paid") },
        { body: { id: "re_1QsAVhLkdIwHu7ixRefund01" } },
      );
      const provider = invoicingProviderFromEnvironment(ENV, fetchImpl);
      await provider.refundInvoice("acct_1Nv0FGQ9RKHgCVdK", "in_1QsAVe", "intent-refund-1");

      const retrieveUrl = String(vi.mocked(fetchImpl).mock.calls[0][0]);
      expect(retrieveUrl).not.toContain("expand");
      expect(stripeObjectFixture("error.invalid-expand-payment-intent")).toMatchObject({
        error: { code: "parameter_unknown", param: "expand[0]" },
      });
    });

    it("still reports not_refundable when the invoice genuinely carries no payment", async () => {
      const fetchImpl = fetchReturning({ body: stripeObjectFixture("invoice.open") });
      const provider = invoicingProviderFromEnvironment(ENV, fetchImpl);

      expect(
        await provider.refundInvoice("acct_1Nv0FGQ9RKHgCVdK", "in_1QsAVe", "intent-refund-1"),
      ).toEqual({ status: "not_refundable" });
      // Nothing to reverse, so no refund was attempted — one call, the retrieve.
      expect(vi.mocked(fetchImpl)).toHaveBeenCalledTimes(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Connect
// ---------------------------------------------------------------------------

describe("connect provider against real Connect payloads", () => {
  it("takes the connected account id out of a real OAuth token response", async () => {
    const provider = connectProviderFromEnvironment(
      ENV,
      fetchReturning({ body: stripeObjectFixture("oauth-token") }),
    );

    expect(
      await provider.exchangeCode(
        "ac_test_code",
        "https://diveday.app/api/stripe/connect/callback",
      ),
    ).toEqual({ status: "connected", stripeAccountId: "acct_1Nv0FGQ9RKHgCVdK" });
  });

  it("reads a real Account's flags, and the currency it actually ships", async () => {
    const account = stripeObjectFixture("account");
    // Two separate claims, and the second is the one that needs care: a real
    // Account always sends `default_currency`, and the schema makes it optional
    // only so an odd payload still parses. Asserting `"usd"` against a `"usd"`
    // fixture proves nothing — `?? "usd"` returns that with the field deleted —
    // so the presence of the field is asserted here and the *reading* of it in
    // the next test, with a value the fallback could never produce.
    expect(account.default_currency).toBe("usd");

    const provider = connectProviderFromEnvironment(ENV, fetchReturning({ body: account }));
    expect(await provider.retrieveAccountStatus("acct_1Nv0FGQ9RKHgCVdK")).toEqual({
      status: "ok",
      account: {
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
        defaultCurrency: "usd",
      },
    });
  });

  it("hands back a non-usd account's own currency rather than the usd fallback", async () => {
    // A Canadian shop's connected account, which is the case the fallback would
    // silently get wrong — and would report every payout in the wrong currency.
    const provider = connectProviderFromEnvironment(
      ENV,
      fetchReturning({ body: { ...stripeObjectFixture("account"), default_currency: "cad" } }),
    );

    const result = await provider.retrieveAccountStatus("acct_1Nv0FGQ9RKHgCVdK");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.account.defaultCurrency).toBe("cad");
  });

  it("reports a restricted account as not chargeable, from its real flag set", async () => {
    // The flag that gates order creation. A Connect account mid-onboarding sends
    // exactly this shape, and reading it wrong lets a shop take money it cannot
    // settle.
    const provider = connectProviderFromEnvironment(
      ENV,
      fetchReturning({
        body: {
          ...stripeObjectFixture("account"),
          charges_enabled: false,
          payouts_enabled: false,
          details_submitted: false,
        },
      }),
    );

    const result = await provider.retrieveAccountStatus("acct_1Nv0FGQ9RKHgCVdK");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.account).toEqual({
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      defaultCurrency: "usd",
    });
  });
});

// ---------------------------------------------------------------------------
// Customers — the erasure attestation
// ---------------------------------------------------------------------------

describe("customer provider against real deletion payloads", () => {
  it("accepts Stripe's deleted-object envelope as proof the customer is gone", async () => {
    const provider = customerProviderFromEnvironment(
      ENV,
      fetchReturning({ body: stripeObjectFixture("customer.deleted") }),
    );

    expect(
      await provider.deleteCustomer(
        "acct_1Nv0FGQ9RKHgCVdK",
        "cus_TQd8mKp2VnRxLa",
        "intent-erase-1",
      ),
    ).toEqual({ status: "deleted" });
  });

  it("refuses to attest erasure from a 200 that returned an intact customer", async () => {
    // A real, *undeleted* Customer object is the honest adversarial input here:
    // it is a 2xx with a matching `id` and no `deleted: true`. Writing
    // "deleted" into a compliance ledger on that basis would be a lie.
    const provider = customerProviderFromEnvironment(
      ENV,
      fetchReturning({ body: stripeObjectFixture("customer") }),
    );

    expect(
      await provider.deleteCustomer(
        "acct_1Nv0FGQ9RKHgCVdK",
        "cus_TQd8mKp2VnRxLa",
        "intent-erase-1",
      ),
    ).toEqual({
      status: "failed",
      error: "stripe did not report the customer deleted",
    });
  });

  it("carries Stripe's own error code into the ledger, truncated", async () => {
    const provider = customerProviderFromEnvironment(
      ENV,
      fetchReturning({
        ok: false,
        status: 400,
        body: stripeObjectFixture("error.invalid-expand-payment-intent"),
      }),
    );

    expect(
      await provider.deleteCustomer(
        "acct_1Nv0FGQ9RKHgCVdK",
        "cus_TQd8mKp2VnRxLa",
        "intent-erase-1",
      ),
    ).toEqual({ status: "failed", error: "HTTP 400: parameter_unknown" });
  });
});

// ---------------------------------------------------------------------------
// Promotions
// ---------------------------------------------------------------------------

describe("promotion provider against real Coupon and PromotionCode payloads", () => {
  it("returns both Stripe ids from the coupon-then-code pair", async () => {
    const provider = promotionProviderFromEnvironment(
      ENV,
      fetchReturning(
        { body: stripeObjectFixture("coupon") },
        { body: stripeObjectFixture("promotion-code") },
      ),
    );

    expect(
      await provider.createTripPromotion({
        stripeAccountId: "acct_1Nv0FGQ9RKHgCVdK",
        code: "SAVE10-A1B2C3",
        percentOff: 10,
        expiresAt: new Date(1_784_727_000 * 1000),
        maxRedemptions: 4,
        idempotencyKey: "intent-promo-1",
      }),
    ).toEqual({
      status: "created",
      stripeCouponId: "cpn_1QsAVeLkdIwHu7ix9YmZaB4C",
      stripePromotionCodeId: "promo_1QsAVfLkdIwHu7ixTgKpQr2S",
    });
  });
});
