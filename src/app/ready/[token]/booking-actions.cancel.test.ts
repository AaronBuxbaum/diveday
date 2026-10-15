import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A party lead's own cancel on /ready (batch 6 item 10): the seats
 * `selfCancelBooking` released with the lead are each refunded under the same
 * policy and named on the trail as the lead's act. The lead is emailed, and so
 * is a released seat with an address of its own; a seat without one is not.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("@/db/bookings", () => ({ addPartySeat: vi.fn(), selfCancelBooking: vi.fn() }));
vi.mock("@/db/refunds", () => ({ refundBookingOnCancellation: vi.fn() }));
vi.mock("@/db/operations", () => ({ recordDiverSelfCancel: vi.fn(async () => ({ id: "e1" })) }));
vi.mock("@/db/booking-cancelled-notice", () => ({ sendBookingCancelledNotice: vi.fn() }));
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.7") }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })) };
});
vi.mock("./action-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./action-helpers")>();
  return { ...actual, contextFor: vi.fn() };
});

const { selfCancelBooking } = await import("@/db/bookings");
const { refundBookingOnCancellation } = await import("@/db/refunds");
const { recordDiverSelfCancel } = await import("@/db/operations");
const { sendBookingCancelledNotice } = await import("@/db/booking-cancelled-notice");
const { contextFor } = await import("./action-helpers");
const { cancelMyBookingAction } = await import("./booking-actions");

const TOKEN = "ready-token";
const LEAD = "0f2a9c1e-1111-4222-8333-444444444444";

async function redirectedTo(): Promise<string> {
  try {
    await cancelMyBookingAction(TOKEN);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw error;
  }
  throw new Error("action returned without redirecting");
}

beforeEach(() => {
  vi.mocked(contextFor).mockResolvedValue({
    ok: true,
    db: {} as never,
    bookingId: LEAD,
    ownLocale: null,
    data: { shop: { id: "shop-1" } } as never,
  });
  vi.mocked(refundBookingOnCancellation).mockResolvedValue({ status: "refunded" } as never);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("cancelMyBookingAction with a party", () => {
  it("asks for the party, refunds each released seat, and emails the lead and no address-less seat", async () => {
    vi.mocked(selfCancelBooking).mockResolvedValue({
      ok: true,
      party: {
        cancelled: [{ bookingId: "milo", seatName: "Milo Ortiz", ownAddress: false }],
        stayed: [{ bookingId: "pia", seatName: "Pia Ortiz" }],
      },
    });

    await expect(redirectedTo()).resolves.toBe(`/ready/${TOKEN}?cancelled=1`);

    expect(selfCancelBooking).toHaveBeenCalledWith(expect.anything(), {
      shopId: "shop-1",
      bookingId: LEAD,
      withUnclaimedParty: true,
    });
    expect(vi.mocked(refundBookingOnCancellation).mock.calls.map(([, input]) => input)).toEqual([
      { shopId: "shop-1", bookingId: LEAD },
      { shopId: "shop-1", bookingId: "milo" },
    ]);
    expect(recordDiverSelfCancel).toHaveBeenCalledWith(expect.anything(), {
      shopId: "shop-1",
      bookingId: "milo",
      refunded: true,
      party: { leadBookingId: LEAD, seatName: "Milo Ortiz" },
    });
    expect(sendBookingCancelledNotice).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendBookingCancelledNotice).mock.calls[0]?.[1]).toMatchObject({
      bookingId: LEAD,
    });
  });

  it("emails a released seat that has its own address (batch 6 layer 2 review)", async () => {
    vi.mocked(selfCancelBooking).mockResolvedValue({
      ok: true,
      party: {
        cancelled: [
          { bookingId: "milo", seatName: "Milo Ortiz", ownAddress: true },
          { bookingId: "tom", seatName: "Tom Ortiz", ownAddress: false },
        ],
        stayed: [],
      },
    });

    await expect(redirectedTo()).resolves.toBe(`/ready/${TOKEN}?cancelled=1`);

    expect(vi.mocked(sendBookingCancelledNotice).mock.calls.map(([, input]) => input)).toEqual([
      expect.objectContaining({ bookingId: LEAD, cancelledBy: "diver" }),
      expect.objectContaining({ bookingId: "milo", cancelledBy: "diver", from: "booked" }),
    ]);
  });

  it("keeps going to the next seat when one seat's refund throws", async () => {
    vi.mocked(selfCancelBooking).mockResolvedValue({
      ok: true,
      party: {
        cancelled: [{ bookingId: "milo", seatName: "Milo Ortiz", ownAddress: false }],
        stayed: [],
      },
    });
    vi.mocked(refundBookingOnCancellation)
      .mockRejectedValueOnce(new Error("db blip"))
      .mockResolvedValueOnce({ status: "refunded" } as never);

    await expect(redirectedTo()).resolves.toBe(`/ready/${TOKEN}?cancelled=1`);
    expect(refundBookingOnCancellation).toHaveBeenCalledTimes(2);
  });
});
