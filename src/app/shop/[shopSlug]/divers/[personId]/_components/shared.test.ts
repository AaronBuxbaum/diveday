import { describe, expect, it } from "vitest";
import {
  cardDisplayStatus,
  cardsNeedingLookCount,
  type DiverProfile,
  HELD_CARD_STATUS_KEYS,
  heldCardDisplayStatus,
  heldCardStatusTone,
  isCardExpired,
  isImportedCard,
  needsImportConfirm,
  paperWaiverBookingId,
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

describe("paperWaiverBookingId", () => {
  const NOW = new Date("2026-07-21T12:00:00Z");

  /** Just enough of a diver profile for the anchor reader; nothing else is touched. */
  function withBookings(
    rows: { id: string; startsAt: string; tripStatus?: string; status?: string }[],
  ): DiverProfile {
    return {
      bookings: rows.map((row) => ({
        booking: { id: row.id, status: row.status ?? "booked" },
        trip: { status: row.tripStatus ?? "scheduled", startsAt: new Date(row.startsAt) },
      })),
    } as unknown as DiverProfile;
  }

  it("anchors on the diver's soonest still-scheduled departure", () => {
    expect(
      paperWaiverBookingId(
        withBookings([
          { id: "later", startsAt: "2026-08-01T12:00:00Z" },
          { id: "sooner", startsAt: "2026-07-25T12:00:00Z" },
        ]),
        NOW,
      ),
    ).toBe("sooner");
  });

  it("ignores a departure that has already left", () => {
    // A release recorded here is filed against a seat, and `recordInPersonWaiver`
    // will not touch a trip that is no longer scheduled — so a past boat is not
    // an anchor, however recently it sailed.
    expect(
      paperWaiverBookingId(
        withBookings([
          { id: "gone", startsAt: "2026-07-20T12:00:00Z" },
          { id: "ahead", startsAt: "2026-07-30T12:00:00Z" },
        ]),
        NOW,
      ),
    ).toBe("ahead");
  });

  it("ignores a cancelled seat and a cancelled trip", () => {
    expect(
      paperWaiverBookingId(
        withBookings([
          { id: "seat-off", startsAt: "2026-07-22T12:00:00Z", status: "cancelled" },
          { id: "boat-off", startsAt: "2026-07-23T12:00:00Z", tripStatus: "cancelled" },
          { id: "real", startsAt: "2026-07-24T12:00:00Z" },
        ]),
        NOW,
      ),
    ).toBe("real");
  });

  it("answers null when the diver has nothing booked ahead", () => {
    // The honest answer, and the page's cue to offer no control at all rather
    // than a button with nowhere to file the record
    // (FU-20260811-paper-waiver-without-a-booking).
    expect(paperWaiverBookingId(withBookings([]), NOW)).toBeNull();
    expect(
      paperWaiverBookingId(withBookings([{ id: "gone", startsAt: "2026-07-01T12:00:00Z" }]), NOW),
    ).toBeNull();
  });
});
