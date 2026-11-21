import { afterEach, describe, expect, it, vi } from "vitest";
import type { getDb } from "@/db/client";
import { resolvePaymentReceipt } from "./payment-receipt";

const db = vi.hoisted(() => ({
  getBookingPayment: vi.fn(),
  tripCreditReceipt: vi.fn(),
  getLatestCheckoutForBooking: vi.fn(),
  refreshCheckoutFromStripe: vi.fn(),
}));

vi.mock("@/features/money/trip-credit", () => ({ tripCreditReceipt: db.tripCreditReceipt }));
vi.mock("@/db/payments", () => ({ getBookingPayment: db.getBookingPayment }));
vi.mock("@/db/checkouts", () => ({
  getLatestCheckoutForBooking: db.getLatestCheckoutForBooking,
  refreshCheckoutFromStripe: db.refreshCheckoutFromStripe,
}));

const handle = {} as Awaited<ReturnType<typeof getDb>>;

afterEach(() => {
  vi.resetAllMocks();
});

describe("resolvePaymentReceipt", () => {
  it("states a settled charge in the currency it was charged in", async () => {
    db.getBookingPayment.mockResolvedValue({
      status: "paid",
      amountCents: 18_000,
      currency: "eur",
    });
    expect(await resolvePaymentReceipt(handle, "shop", "booking", false, 18_000, "usd")).toEqual({
      amountCents: 18_000,
      currency: "eur",
      isDeposit: false,
      balanceDueCents: 0,
    });
  });

  it("works out a deposit's balance from the fare, and quotes none on an unpriced trip", async () => {
    db.getBookingPayment.mockResolvedValue({ status: "deposit_paid", amountCents: 5_000 });
    expect(
      await resolvePaymentReceipt(handle, "shop", "booking", false, 18_000, "usd"),
    ).toMatchObject({ isDeposit: true, balanceDueCents: 13_000, currency: "usd" });
    expect(
      await resolvePaymentReceipt(handle, "shop", "booking", false, null, "usd"),
    ).toMatchObject({ isDeposit: true, balanceDueCents: 0 });
  });

  it("asks Stripe about an open checkout only on a return from Stripe", async () => {
    db.getBookingPayment.mockResolvedValue(null);
    db.getLatestCheckoutForBooking.mockResolvedValue({ id: "co", status: "pending" });
    expect(await resolvePaymentReceipt(handle, "shop", "booking", false, 18_000, "usd")).toBeNull();
    expect(db.getLatestCheckoutForBooking).not.toHaveBeenCalled();
    expect(db.refreshCheckoutFromStripe).not.toHaveBeenCalled();

    db.refreshCheckoutFromStripe.mockResolvedValue({ status: "completed" });
    db.getBookingPayment
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ status: "paid", amountCents: 18_000, currency: "usd" });
    expect(
      await resolvePaymentReceipt(handle, "shop", "booking", true, 18_000, "usd"),
    ).toMatchObject({ amountCents: 18_000, isDeposit: false });
    expect(db.refreshCheckoutFromStripe).toHaveBeenCalledWith(handle, "shop", "co");
  });

  it("says nothing for a waived payment, even straight off Stripe", async () => {
    db.getBookingPayment.mockResolvedValue({ status: "waived" });
    expect(await resolvePaymentReceipt(handle, "shop", "booking", true, 18_000, "usd")).toBeNull();
    expect(db.getLatestCheckoutForBooking).not.toHaveBeenCalled();
  });
});

it("states only verified promotional coverage and never refreshes Stripe for its zero-cash receipt", async () => {
  const { tripCreditReceipt } = await import("@/features/money/trip-credit");
  vi.mocked(tripCreditReceipt).mockResolvedValue({
    amountCents: 18_000,
    balanceCents: 5_000,
    currency: "usd",
  });
  db.getBookingPayment.mockResolvedValue({
    status: "paid",
    amountCents: 0,
    currency: "usd",
    provider: "trip_credit",
    providerRef: "credit-debit",
  });
  expect(await resolvePaymentReceipt(handle, "shop", "booking", true, 18_000, "usd")).toMatchObject(
    {
      amountCents: 0,
      isDeposit: false,
      balanceDueCents: 0,
      tripCredit: { amountCents: 18_000, balanceCents: 5_000 },
    },
  );
  expect(db.getLatestCheckoutForBooking).not.toHaveBeenCalled();
  expect(db.refreshCheckoutFromStripe).not.toHaveBeenCalled();
  vi.mocked(tripCreditReceipt).mockResolvedValue(null);
  expect(await resolvePaymentReceipt(handle, "shop", "booking", false, 18_000, "usd")).toBeNull();
});
