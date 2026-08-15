import { describe, expect, it } from "vitest";
import type { BadgeTone } from "@/components/ui/badge";
import { orderStatus, paymentStatus } from "@/db/schema";
import { ORDER_STATUS_KEYS, ORDER_STATUS_TONES } from "@/i18n/order-labels";
import {
  bookingMoney,
  bookingMoneyStatusTone,
  cardDisplayStatus,
  cardsNeedingLookCount,
  type DiverProfile,
  HELD_CARD_STATUS_KEYS,
  heldCardDisplayStatus,
  heldCardStatusTone,
  isCardExpired,
  isImportedCard,
  needsImportConfirm,
  PAYMENT_STATUS_KEYS,
  PAYMENT_STATUS_TONES,
  unpaidBookingCount,
} from "./shared";

const TODAY = "2026-07-21";

describe("certification card display state", () => {
  it("treats a card past its expiry as expired", () => {
    expect(isCardExpired({ expiresAt: "2026-01-01" }, TODAY)).toBe(true);
  });

  it("does not treat a future or missing expiry as expired", () => {
    expect(isCardExpired({ expiresAt: "2027-01-01" }, TODAY)).toBe(false);
    expect(isCardExpired({ expiresAt: null }, TODAY)).toBe(false);
    expect(isCardExpired({}, TODAY)).toBe(false);
  });

  it("shows an expired verified card as `expired`, not `certified`", () => {
    expect(cardDisplayStatus({ status: "verified", expiresAt: "2026-01-01" }, TODAY)).toBe(
      "expired",
    );
  });

  it("keeps a verified, unexpired card certified", () => {
    expect(cardDisplayStatus({ status: "verified", expiresAt: null }, TODAY)).toBe("verified");
    expect(cardDisplayStatus({ status: "verified", expiresAt: "2027-01-01" }, TODAY)).toBe(
      "verified",
    );
  });

  it("leaves a pending card pending even once its stated expiry has passed", () => {
    // Expiry is only meaningful for a card that was actually certified; a pending
    // card still needs staff review, so it must not read as `expired`.
    expect(cardDisplayStatus({ status: "pending", expiresAt: "2026-01-01" }, TODAY)).toBe(
      "pending",
    );
  });
});

describe("imported card provenance and confirm nudge", () => {
  it("flags any card with an importedAt as imported", () => {
    expect(isImportedCard({ importedAt: new Date() })).toBe(true);
    expect(isImportedCard({ importedAt: null })).toBe(false);
    expect(isImportedCard({})).toBe(false);
  });

  it("needs a confirm only while imported and not yet reviewed", () => {
    // Imported, no staff review yet → the one-tap confirm nudge shows.
    expect(needsImportConfirm({ importedAt: new Date(), reviewedAt: null })).toBe(true);
    // Imported but a staffer already confirmed → no nudge; the imported flag stays.
    expect(needsImportConfirm({ importedAt: new Date(), reviewedAt: new Date() })).toBe(false);
    // A hand-entered card (never imported) is not a confirm-nudge case.
    expect(needsImportConfirm({ importedAt: null, reviewedAt: null })).toBe(false);
  });
});

describe("heldCardDisplayStatus", () => {
  const today = "2026-07-25";

  it("distinguishes a card whose gate is still shut from one that clears", () => {
    // The badge is the only thing on screen saying so. A hand-verified card reads
    // plain "certified" and does clear; an imported, unconfirmed one holds its
    // gate — the specialty dive, or the enriched-air fill — so it must not look
    // identical at a busy desk (H-24).
    const confirmed = {
      status: "verified" as const,
      importedAt: new Date(),
      reviewedAt: new Date(),
    };
    const unconfirmed = { status: "verified" as const, importedAt: new Date(), reviewedAt: null };
    const byHand = { status: "verified" as const, importedAt: null, reviewedAt: null };

    expect(heldCardDisplayStatus(unconfirmed, today)).toBe("confirm_to_clear");
    expect(HELD_CARD_STATUS_KEYS.confirm_to_clear).toBe("divers.shared.cardStatus.confirmToClear");
    expect(heldCardStatusTone("confirm_to_clear")).toBe("warning");

    // Both of these genuinely clear, so both keep the plain certified badge.
    expect(heldCardDisplayStatus(confirmed, today)).toBe("verified");
    expect(heldCardDisplayStatus(byHand, today)).toBe("verified");
    expect(heldCardStatusTone("verified")).toBe("success");
  });

  it("lets an overdue refresher outrank the confirm, since expiry is the harder fact", () => {
    expect(
      heldCardDisplayStatus(
        { status: "verified", expiresAt: "2026-07-17", importedAt: new Date(), reviewedAt: null },
        today,
      ),
    ).toBe("expired");
  });
});

/**
 * The status vocabulary money wears, and the one place it is proved whole.
 *
 * `ORDER_STATUS_TONES` lives in `src/i18n/order-labels.ts`, which may not
 * import `src/components` (`pnpm check:architecture`) and therefore cannot say
 * `Record<OrderStatus, BadgeTone>` out loud. It is `as const` instead, so every
 * `<Badge tone={…}>` call site re-proves assignability — and this file, which
 * *may* import both, is where that proof is made once and directly.
 */
describe("money status vocabulary", () => {
  /** Assignable to `BadgeTone` or this does not compile — the point of the test. */
  const orderTones: Record<string, BadgeTone> = ORDER_STATUS_TONES;

  it("gives every stored order status both a word and a tone", () => {
    for (const status of orderStatus.enumValues) {
      expect(ORDER_STATUS_KEYS[status], status).toBeTruthy();
      expect(orderTones[status], status).toBeTruthy();
    }
  });

  it("gives every stored booking-payment status both a word and a tone", () => {
    for (const status of paymentStatus.enumValues) {
      expect(PAYMENT_STATUS_KEYS[status], status).toBeTruthy();
      expect(PAYMENT_STATUS_TONES[status], status).toBeTruthy();
    }
  });

  /**
   * The regression this pass fixed: `refunded` was amber on the Orders index,
   * grey on the order detail page, and grey again in two hand-rolled pills on
   * the diver record. One refund, four readings.
   */
  it("colours a refund the same whichever record carries it", () => {
    expect(ORDER_STATUS_TONES.refunded).toBe("warning");
    expect(PAYMENT_STATUS_TONES.refunded).toBe(ORDER_STATUS_TONES.refunded);
  });

  it("keeps a written-off invoice distinguishable from a voided one", () => {
    // Both used to render the same grey. `uncollectible` is money the shop
    // billed and will not receive; `void` is an invoice that never counted.
    expect(ORDER_STATUS_TONES.uncollectible).toBe("danger");
    expect(ORDER_STATUS_TONES.void).toBe("neutral");
  });

  it("still knows paid is a success, though the index chooses not to show it", () => {
    // The index's `status === "paid" ? null : <Badge…>` is a caller's call. A
    // hole in the map would instead have made paid *grey* on the order detail
    // page and the diver's Payments list, which do show it.
    expect(ORDER_STATUS_TONES.paid).toBe("success");
  });
});

/**
 * A booking's row reads its word and its colour off the same record, in the
 * same order — never the order's status wearing the payment row's tone.
 */
describe("bookingMoneyStatusTone", () => {
  function money(input: {
    orders?: { bookingId: string | null; status: string }[];
    payments?: { bookingId: string; status: string }[];
  }) {
    return bookingMoney(
      {
        orders: (input.orders ?? []).map((order) => ({ order })),
        bookingPayments: (input.payments ?? []).map((payment) => ({
          booking: { id: payment.bookingId },
          payment,
        })),
      } as unknown as DiverProfile,
      "booking-1",
    );
  }

  it("takes the order's tone when one has been raised", () => {
    expect(
      bookingMoneyStatusTone(money({ orders: [{ bookingId: "booking-1", status: "open" }] })),
    ).toBe("primary");
    expect(
      bookingMoneyStatusTone(money({ orders: [{ bookingId: "booking-1", status: "refunded" }] })),
    ).toBe("warning");
  });

  it("prefers the order over the booking payment — the order is the billing record", () => {
    expect(
      bookingMoneyStatusTone(
        money({
          orders: [{ bookingId: "booking-1", status: "refunded" }],
          payments: [{ bookingId: "booking-1", status: "paid" }],
        }),
      ),
    ).toBe("warning");
  });

  it("falls back to the booking's own payment status", () => {
    expect(
      bookingMoneyStatusTone(money({ payments: [{ bookingId: "booking-1", status: "unpaid" }] })),
    ).toBe("warning");
  });

  it("stays neutral when nothing has been raised — an absence is not a bad fact", () => {
    expect(bookingMoneyStatusTone(money({}))).toBe("neutral");
  });

  it("never reads another booking's money onto this row", () => {
    expect(
      bookingMoneyStatusTone(money({ orders: [{ bookingId: "booking-2", status: "refunded" }] })),
    ).toBe("neutral");
  });
});

/**
 * The signals the record's top cards wear a "Needs attention" badge for. Both
 * are asked of the same rows the sections below render, so a card and the list
 * under it can never disagree about the same seat.
 */
describe("unpaidBookingCount", () => {
  /** Just enough of a diver profile for the money readers; nothing else is touched. */
  function profile(input: {
    bookings: { id: string; status?: string }[];
    orders?: { bookingId: string | null; status: string }[];
    payments?: { bookingId: string; status: string }[];
  }): DiverProfile {
    return {
      bookings: input.bookings.map((booking) => ({
        booking: { id: booking.id, status: booking.status ?? "booked" },
      })),
      orders: (input.orders ?? []).map((order) => ({ order })),
      bookingPayments: (input.payments ?? []).map((payment) => ({
        booking: { id: payment.bookingId },
        payment: { status: payment.status },
      })),
    } as unknown as DiverProfile;
  }

  it("counts a seat whose order is still open", () => {
    expect(
      unpaidBookingCount(
        profile({ bookings: [{ id: "b1" }], orders: [{ bookingId: "b1", status: "open" }] }),
      ),
    ).toBe(1);
  });

  it("does not count a seat whose order is settled", () => {
    for (const status of ["paid", "void", "refunded", "uncollectible"]) {
      expect(
        unpaidBookingCount(
          profile({ bookings: [{ id: "b1" }], orders: [{ bookingId: "b1", status }] }),
        ),
      ).toBe(0);
    }
  });

  it("falls back to the booking's own payment status when no order was raised", () => {
    expect(
      unpaidBookingCount(
        profile({ bookings: [{ id: "b1" }], payments: [{ bookingId: "b1", status: "unpaid" }] }),
      ),
    ).toBe(1);
    for (const status of ["paid", "deposit_paid", "waived", "refunded"]) {
      expect(
        unpaidBookingCount(
          profile({ bookings: [{ id: "b1" }], payments: [{ bookingId: "b1", status }] }),
        ),
      ).toBe(0);
    }
  });

  it("does not call an un-invoiced seat unpaid — nothing is owed until something is raised", () => {
    expect(unpaidBookingCount(profile({ bookings: [{ id: "b1" }] }))).toBe(0);
  });

  it("ignores cancelled seats — a void or a refund is not somebody owing money", () => {
    expect(
      unpaidBookingCount(
        profile({
          bookings: [{ id: "b1", status: "cancelled" }],
          orders: [{ bookingId: "b1", status: "open" }],
        }),
      ),
    ).toBe(0);
  });

  it("lets the order win over the booking's payment row — it is the billing record", () => {
    expect(
      unpaidBookingCount(
        profile({
          bookings: [{ id: "b1" }],
          orders: [{ bookingId: "b1", status: "paid" }],
          payments: [{ bookingId: "b1", status: "unpaid" }],
        }),
      ),
    ).toBe(0);
  });
});

describe("cardsNeedingLookCount", () => {
  function cards(input: {
    level?: { status: string; importedAt?: Date; reviewedAt?: Date }[];
    specialty?: { status: string; importedAt?: Date; reviewedAt?: Date }[];
    nitrox?: { status: string; importedAt?: Date; reviewedAt?: Date }[];
  }): DiverProfile {
    return {
      certifications: input.level ?? [],
      specialtyCertifications: input.specialty ?? [],
      nitroxCertifications: input.nitrox ?? [],
    } as unknown as DiverProfile;
  }

  it("counts every card awaiting review, whatever kind it is", () => {
    expect(
      cardsNeedingLookCount(
        cards({
          level: [{ status: "pending" }],
          specialty: [{ status: "pending" }],
          nitrox: [{ status: "pending" }],
        }),
      ),
    ).toBe(3);
  });

  it("counts an imported specialty or nitrox card whose gate is still shut (H-24)", () => {
    const imported = { status: "verified", importedAt: new Date("2026-07-01") };
    expect(cardsNeedingLookCount(cards({ specialty: [imported], nitrox: [imported] }))).toBe(2);
  });

  it("does not count an imported level card — it cleared readiness on arrival", () => {
    expect(
      cardsNeedingLookCount(
        cards({ level: [{ status: "verified", importedAt: new Date("2026-07-01") }] }),
      ),
    ).toBe(0);
  });

  it("counts nothing once every card is certified and confirmed", () => {
    const confirmed = {
      status: "verified",
      importedAt: new Date("2026-07-01"),
      reviewedAt: new Date("2026-07-02"),
    };
    expect(
      cardsNeedingLookCount(
        cards({ level: [confirmed], specialty: [confirmed], nitrox: [confirmed] }),
      ),
    ).toBe(0);
  });
});
