// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { getDb } from "@/db/client";
import { diverTranslator } from "@/i18n/messages";
import { readyDeadLink } from "./dead-link";

const db = vi.hoisted(() => ({
  resolveRevokedBookingCapability: vi.fn(),
  staleBookingCapabilityForToken: vi.fn(),
  getReadyPageData: vi.fn(),
  getBookingPayment: vi.fn(),
  getShopById: vi.fn(),
  partySeatsKeptAfterLeadCancel: vi.fn(),
  verifyStrandedBookingCapability: vi.fn(),
  strandedMoveAsk: vi.fn(),
}));
const card = vi.hoisted(() => ({ props: vi.fn() }));

vi.mock("@/db/booking-capabilities", () => ({
  resolveRevokedBookingCapability: db.resolveRevokedBookingCapability,
  staleBookingCapabilityForToken: db.staleBookingCapabilityForToken,
  verifyStrandedBookingCapability: db.verifyStrandedBookingCapability,
}));
vi.mock("@/db/move-offer", () => ({ strandedMoveAsk: db.strandedMoveAsk }));
vi.mock("../booking-actions", () => ({ askToMoveFromCancelledAction: vi.fn() }));
vi.mock("@/db/ready", () => ({ getReadyPageData: db.getReadyPageData }));
vi.mock("@/db/payments", () => ({ getBookingPayment: db.getBookingPayment }));
vi.mock("@/db/shops", () => ({ getShopById: db.getShopById }));
vi.mock("@/db/seat-claims", () => ({
  partySeatsKeptAfterLeadCancel: db.partySeatsKeptAfterLeadCancel,
}));
vi.mock("@/db/series-next", () => ({ nextPublicTripInSeries: async () => null }));
vi.mock("@/i18n/request", () => ({ requestLocale: async () => "en-US" }));
vi.mock("./ExpiredLink", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ExpiredLink")>()),
  ExpiredLink: () => <p>expired-with-shop</p>,
}));
vi.mock("./TripCancelledCard", () => ({
  TripCancelledCard: (props: Record<string, unknown>) => {
    card.props(props);
    return <p>departure-cancelled</p>;
  },
}));

const t = diverTranslator("en-US");
const handle = {} as Awaited<ReturnType<typeof getDb>>;

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

async function show(cancelled?: string, error?: string) {
  render(
    await readyDeadLink({ db: handle, token: "tok", cancelled, sent: undefined, error, anonT: t }),
  );
}

describe("readyDeadLink", () => {
  it("confirms the diver's own cancel from the booking's payment row", async () => {
    db.resolveRevokedBookingCapability.mockResolvedValue({ bookingId: "b1" });
    db.getReadyPageData.mockResolvedValue({
      detail: {
        cancelled: true,
        trip: { title: "Two-Tank Reef" },
        shop: { name: "Blue Mantis", timezone: "America/New_York" },
      },
      trip: { id: "t1" },
      shop: { id: "s1", slug: "blue-mantis" },
    });
    db.getBookingPayment.mockResolvedValue(null);
    db.partySeatsKeptAfterLeadCancel.mockResolvedValue([]);
    await show("1");
    expect(screen.getByText(t("ready.cancelledHeading"))).toBeTruthy();
    expect(db.getBookingPayment).toHaveBeenCalledWith(handle, "s1", "b1");
  });

  it("tells a party lead which of the seats they booked stayed (batch 6 item 10)", async () => {
    db.resolveRevokedBookingCapability.mockResolvedValue({ bookingId: "b1" });
    db.getReadyPageData.mockResolvedValue({
      detail: {
        cancelled: true,
        trip: { title: "Two-Tank Reef" },
        shop: { name: "Blue Mantis", timezone: "America/New_York" },
      },
      trip: { id: "t1" },
      shop: { id: "s1", slug: "blue-mantis" },
    });
    db.getBookingPayment.mockResolvedValue(null);
    db.partySeatsKeptAfterLeadCancel.mockResolvedValue(["Pia Ortiz"]);
    await show("1");
    expect(
      screen.getByText(
        t("ready.cancelledPartyKept", { count: 1, names: "Pia Ortiz", trip: "Two-Tank Reef" }),
        { exact: false },
      ),
    ).toBeTruthy();
    expect(db.partySeatsKeptAfterLeadCancel).toHaveBeenCalledWith(handle, {
      shopId: "s1",
      leadBookingId: "b1",
    });
  });

  it("tells a diver stranded by a called-off departure the truth, not that the link expired", async () => {
    db.resolveRevokedBookingCapability.mockResolvedValue({ bookingId: "b1" });
    db.getReadyPageData.mockResolvedValue({
      departureCancelled: true,
      detail: { cancelled: false },
      shop: { defaultLocale: "en-US" },
    });
    await show();
    expect(screen.getByText("departure-cancelled")).toBeTruthy();
    expect(db.staleBookingCapabilityForToken).not.toHaveBeenCalled();
  });

  const STRANDED_PAGE = {
    departureCancelled: true,
    detail: { cancelled: false },
    shop: { id: "s1", defaultLocale: "en-US" },
  };
  const OPEN = {
    state: "open",
    offer: { tripId: "t2", title: "Two-Tank Reef", startsAt: new Date("2026-10-29T16:00:00Z") },
  };

  it("offers the move on a live stranded link, read for the link's own booking", async () => {
    db.resolveRevokedBookingCapability.mockResolvedValue({ bookingId: "b1" });
    db.getReadyPageData.mockResolvedValue(STRANDED_PAGE);
    db.verifyStrandedBookingCapability.mockResolvedValue({ bookingId: "b1", shopId: "s1" });
    db.strandedMoveAsk.mockResolvedValue(OPEN);
    await show(undefined, "move-ask");
    expect(db.strandedMoveAsk).toHaveBeenCalledWith(
      handle,
      expect.objectContaining({ shopId: "s1", bookingId: "b1" }),
    );
    expect(card.props).toHaveBeenCalledWith(
      expect.objectContaining({ moveAsk: OPEN, notice: "move-ask", locale: "en-US" }),
    );
  });

  it("offers nothing on a revoked link, which still reads the card", async () => {
    db.resolveRevokedBookingCapability.mockResolvedValue({ bookingId: "b1" });
    db.getReadyPageData.mockResolvedValue(STRANDED_PAGE);
    db.verifyStrandedBookingCapability.mockResolvedValue(null);
    await show();
    expect(screen.getByText("departure-cancelled")).toBeTruthy();
    expect(db.strandedMoveAsk).not.toHaveBeenCalled();
    expect(card.props).toHaveBeenCalledWith(expect.objectContaining({ moveAsk: null }));
  });

  it("names the shop an expired token still resolves", async () => {
    db.resolveRevokedBookingCapability.mockResolvedValue(null);
    db.staleBookingCapabilityForToken.mockResolvedValue({ shopId: "s1" });
    db.getShopById.mockResolvedValue({ id: "s1", defaultLocale: "en-US" });
    await show();
    expect(screen.getByText("expired-with-shop")).toBeTruthy();
  });

  it("says only that the link is unavailable when nothing resolves", async () => {
    db.resolveRevokedBookingCapability.mockResolvedValue(null);
    db.staleBookingCapabilityForToken.mockResolvedValue(null);
    await show();
    expect(screen.getByText(t("common.deadLinkHeading"))).toBeTruthy();
    expect(db.getReadyPageData).not.toHaveBeenCalled();
  });
});
