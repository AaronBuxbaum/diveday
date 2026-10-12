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
}));

vi.mock("@/db/booking-capabilities", () => ({
  resolveRevokedBookingCapability: db.resolveRevokedBookingCapability,
  staleBookingCapabilityForToken: db.staleBookingCapabilityForToken,
}));
vi.mock("@/db/ready", () => ({ getReadyPageData: db.getReadyPageData }));
vi.mock("@/db/payments", () => ({ getBookingPayment: db.getBookingPayment }));
vi.mock("@/db/shops", () => ({ getShopById: db.getShopById }));
vi.mock("@/i18n/request", () => ({ requestLocale: async () => "en-US" }));
vi.mock("./ExpiredLink", () => ({ ExpiredLink: () => <p>expired-with-shop</p> }));
vi.mock("./TripCancelledCard", () => ({ TripCancelledCard: () => <p>departure-cancelled</p> }));

const t = diverTranslator("en-US");
const handle = {} as Awaited<ReturnType<typeof getDb>>;

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

async function show(cancelled?: string) {
  render(await readyDeadLink({ db: handle, token: "tok", cancelled, sent: undefined, anonT: t }));
}

describe("readyDeadLink", () => {
  it("confirms the diver's own cancel from the booking's payment row", async () => {
    db.resolveRevokedBookingCapability.mockResolvedValue({ bookingId: "b1" });
    db.getReadyPageData.mockResolvedValue({
      detail: { cancelled: true, trip: { title: "Two-Tank Reef" }, shop: { name: "Blue Mantis" } },
      shop: { id: "s1" },
    });
    db.getBookingPayment.mockResolvedValue(null);
    await show("1");
    expect(screen.getByText(t("ready.cancelledHeading"))).toBeTruthy();
    expect(db.getBookingPayment).toHaveBeenCalledWith(handle, "s1", "b1");
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
    expect(screen.getByText(t("ready.unavailableHeading"))).toBeTruthy();
    expect(db.getReadyPageData).not.toHaveBeenCalled();
  });
});
