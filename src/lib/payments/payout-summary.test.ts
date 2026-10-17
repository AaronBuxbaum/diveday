import { describe, expect, it, vi } from "vitest";
import {
  MAX_PAYOUT_SUMMARY_PAGES,
  payoutSummaryLookupFromEnvironment,
  stripePayoutSummaryLookup,
} from "./payout-summary";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

const SEP_27 = Date.UTC(2026, 8, 27, 15) / 1000;
const SEP_29 = Date.UTC(2026, 8, 29, 18) / 1000;
const OCT_1 = Date.UTC(2026, 9, 1, 12) / 1000;
const OCT_3 = Date.UTC(2026, 9, 3, 2) / 1000;

describe("stripePayoutSummaryLookup", () => {
  it("reads the payout's transactions on the connected account, read-only, and sums the fees", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        has_more: false,
        data: [
          { id: "txn_payout", type: "payout", created: OCT_3, fee: 0 },
          { id: "txn_3", type: "charge", created: OCT_1, fee: 640 },
          { id: "txn_2", type: "refund", created: SEP_29, fee: -30 },
          { id: "txn_1", type: "payment", created: SEP_27, fee: 520 },
        ],
      }),
    );
    const lookup = stripePayoutSummaryLookup({ secretKey: "sk_test_x" }, fetchImpl as never);
    expect(await lookup.summarize("acct_1", "po_1", { automatic: true })).toEqual({
      status: "summarized",
      coveredFrom: new Date(SEP_27 * 1000),
      coveredTo: new Date(OCT_1 * 1000),
      feeCents: 1130,
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/balance_transactions?payout=po_1&limit=100");
    expect(init.method).toBeUndefined();
    expect(init.headers).toMatchObject({ "Stripe-Account": "acct_1" });
  });

  it("pages on until Stripe says there is no more", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          has_more: true,
          data: [{ id: "txn_2", type: "charge", created: OCT_1, fee: 100 }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          has_more: false,
          data: [{ id: "txn_1", type: "charge", created: SEP_27, fee: 200 }],
        }),
      );
    const lookup = stripePayoutSummaryLookup({ secretKey: "sk_test_x" }, fetchImpl);
    expect(await lookup.summarize("acct_1", "po_1", { automatic: true })).toMatchObject({
      status: "summarized",
      coveredFrom: new Date(SEP_27 * 1000),
      feeCents: 300,
    });
    expect(fetchImpl.mock.calls[1]?.[0]).toBe(
      "https://api.stripe.com/v1/balance_transactions?payout=po_1&limit=100&starting_after=txn_2",
    );
  });

  it("gives up on a list longer than it reads rather than report part of it", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        has_more: true,
        data: [{ id: "txn", type: "charge", created: OCT_1, fee: 1 }],
      }),
    );
    const lookup = stripePayoutSummaryLookup({ secretKey: "sk_test_x" }, fetchImpl as never);
    expect(await lookup.summarize("acct_1", "po_1", { automatic: true })).toEqual({
      status: "unavailable",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(MAX_PAYOUT_SUMMARY_PAGES);
  });

  it("a payout carrying only its own movement has no span", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        has_more: false,
        data: [{ id: "t", type: "payout", created: OCT_3, fee: 0 }],
      }),
    );
    const lookup = stripePayoutSummaryLookup({ secretKey: "sk_test_x" }, fetchImpl as never);
    expect(await lookup.summarize("acct_1", "po_1", { automatic: true })).toEqual({
      status: "summarized",
      coveredFrom: null,
      coveredTo: null,
      feeCents: 0,
    });
  });

  it("reads a manual payout's own balance transaction for its fee, with no span", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        has_more: false,
        data: [{ id: "txn_po", type: "payout", created: OCT_3, fee: 150 }],
      }),
    );
    const lookup = stripePayoutSummaryLookup({ secretKey: "sk_test_x" }, fetchImpl as never);
    expect(await lookup.summarize("acct_1", "po_1", { automatic: false })).toEqual({
      status: "summarized",
      coveredFrom: null,
      coveredTo: null,
      feeCents: 150,
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/balance_transactions?source=po_1&limit=100");
    expect(init.headers).toMatchObject({ "Stripe-Account": "acct_1" });
  });

  it("records no fee for a manual payout whose balance transaction Stripe does not show", async () => {
    const empty = vi.fn(async () => jsonResponse({ has_more: false, data: [] }));
    expect(
      await stripePayoutSummaryLookup({ secretKey: "sk_test_x" }, empty as never).summarize(
        "acct_1",
        "po_1",
        { automatic: false },
      ),
    ).toEqual({ status: "unavailable" });
    const busy = vi.fn(async () => jsonResponse({ error: {} }, 503));
    expect(
      await stripePayoutSummaryLookup({ secretKey: "sk_test_x" }, busy as never).summarize(
        "acct_1",
        "po_1",
        { automatic: false },
      ),
    ).toEqual({ status: "failed" });
  });

  it.each([
    [429, "failed"],
    [503, "failed"],
    [400, "unavailable"],
    [403, "unavailable"],
  ] as const)("a %i answers %s", async (httpStatus, expected) => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: {} }, httpStatus));
    const lookup = stripePayoutSummaryLookup({ secretKey: "sk_test_x" }, fetchImpl as never);
    expect(await lookup.summarize("acct_1", "po_1", { automatic: true })).toEqual({
      status: expected,
    });
  });

  it("a thrown request or an unreadable body is a retry, not a summary", async () => {
    const thrown = stripePayoutSummaryLookup({ secretKey: "sk_test_x" }, (async () => {
      throw new TypeError("network");
    }) as never);
    expect(await thrown.summarize("acct_1", "po_1", { automatic: true })).toEqual({
      status: "failed",
    });
    const garbledFetch = vi.fn(async () => jsonResponse({ nope: true }));
    const garbled = stripePayoutSummaryLookup({ secretKey: "sk_test_x" }, garbledFetch as never);
    expect(await garbled.summarize("acct_1", "po_1", { automatic: true })).toEqual({
      status: "failed",
    });
  });
});

describe("payoutSummaryLookupFromEnvironment", () => {
  it("asks nothing without a key, or with a key of the other mode", async () => {
    const fetchImpl = vi.fn();
    expect(
      await payoutSummaryLookupFromEnvironment({}, fetchImpl).summarize("acct_1", "po_1", {
        automatic: true,
      }),
    ).toEqual({ status: "unavailable" });
    expect(
      await payoutSummaryLookupFromEnvironment({ STRIPE_SECRET_KEY: "sk_live_abc" }, fetchImpl, {
        livemode: false,
      }).summarize("acct_1", "po_1", { automatic: true }),
    ).toEqual({ status: "unavailable" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
