import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReadyPageData } from "@/db/ready";

vi.mock("@/lib/observability/render-connection", () => ({
  connectionForRoute: vi.fn(async () => undefined),
}));
vi.mock("@/db/client", async (original) => ({
  ...(await original<typeof import("@/db/client")>()),
  getDb: vi.fn(async () => ({})),
}));
vi.mock("@/db/booking-capabilities", async (original) => ({
  ...(await original<typeof import("@/db/booking-capabilities")>()),
  verifyBookingCapability: vi.fn(async () => ({
    bookingId: "booking",
    shopId: "shop",
    delivered: true,
  })),
}));
vi.mock("@/db/ready", () => ({ getBookedCard: vi.fn(), getReadyPageData: vi.fn() }));
vi.mock("@/db/seat-claims", async (original) => ({
  ...(await original<typeof import("@/db/seat-claims")>()),
  issuePartySeatClaims: vi.fn(async () => []),
}));
vi.mock("@/i18n/request", () => ({ requestLocale: vi.fn(async () => "en-US") }));
const { getBookedCard, getReadyPageData } = await import("@/db/ready");
const { issuePartySeatClaims } = await import("@/db/seat-claims");
const { ReadyBookedShell } = await import("./_components/ReadyBookedShell");
const { default: ReadyTokenPage } = await import("./page");
const trip = {
  id: "trip",
  title: "Reef",
  startsAt: new Date("2099-10-26T12:00:00Z"),
  endsAt: new Date("2099-10-26T16:00:00Z"),
};
afterEach(() => vi.clearAllMocks());
describe("the booked opening with optional date actions", () => {
  it.each([false, true])(
    "returns the narrow booked card before readiness resolves, cancelled-race=%s",
    async (cancelled) => {
      const pending = Promise.withResolvers<ReadyPageData | null>();
      vi.mocked(getReadyPageData).mockReturnValueOnce(pending.promise);
      vi.mocked(getBookedCard).mockResolvedValueOnce({
        trip,
        shop: {
          name: "Reef",
          slug: "reef",
          timezone: "UTC",
          defaultLocale: "en-US",
          dockCallMinutes: 30,
        },
        pickup: { time: null, location: null },
        greetingName: "Sam",
        bookingCancelled: false,
        departureCancelled: false,
      } as Awaited<ReturnType<typeof getBookedCard>>);
      // If the route awaits the full loader above its booked card, this cannot
      // resolve and the normal test timeout exposes the first-paint regression.
      const result = (await ReadyTokenPage({
        params: Promise.resolve({ token: "synthetic" }),
        searchParams: Promise.resolve({ booked: "1" }),
      })) as ReactElement<{ dateActions: ReactElement<{ fallback: unknown }> }>;
      expect(result.type).toBe(ReadyBookedShell);
      expect(result.props.dateActions.props.fallback).toBeNull();
      expect(getReadyPageData).toHaveBeenCalledTimes(1);
      expect(issuePartySeatClaims).not.toHaveBeenCalled();
      pending.resolve({
        detail: { cancelled, trip },
        departureCancelled: false,
        seatReleased: false,
      } as ReadyPageData);
      await pending.promise;
      await Promise.resolve();
      if (cancelled) expect(issuePartySeatClaims).not.toHaveBeenCalled();
      else
        expect(issuePartySeatClaims).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
          shopId: "shop",
          leadBookingId: "booking",
        });
    },
  );
});
