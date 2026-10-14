// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { diverTranslator } from "@/i18n/messages";

vi.mock("@/db/series-next", () => ({ nextPublicTripInSeries: vi.fn(async () => null) }));

const { nextPublicTripInSeries } = await import("@/db/series-next");
const { cancelledNotice } = await import("./CancelledNotice");

const t = diverTranslator("en-US");
const db = {} as never;

afterEach(cleanup);

function input(paymentStatus: string | null, shopName = "Blue Mantis Divers") {
  return {
    paymentStatus,
    trip: { id: "trip-1", title: "Two-Tank Reef" },
    shop: { id: "shop-1", slug: "blue-mantis", name: shopName, timezone: "America/New_York" },
    locale: "en-US",
    t,
  };
}

describe("cancelledNotice", () => {
  it("says the seat was released when nothing was paid", async () => {
    render(await cancelledNotice(db, input(null)));
    expect(screen.getByText(t("ready.cancelledHeading"))).toBeTruthy();
    expect(
      screen.getByText(
        t("ready.cancelledSeatReleased", { trip: "Two-Tank Reef", shop: "Blue Mantis Divers" }),
      ),
    ).toBeTruthy();
  });

  it("reads its refund line from the payment row's status", async () => {
    const { container } = render(await cancelledNotice(db, input("refunded", "Shop")));
    expect(container.textContent).not.toContain(
      t("ready.cancelledSeatReleased", { trip: "Two-Tank Reef", shop: "Shop" }),
    );
  });

  /**
   * **Never a dead end** (third UX review, item 16): the page carried the
   * heading and the money sentence and nothing to tap.
   */
  it("opens a door to the shop's schedule", async () => {
    render(await cancelledNotice(db, input(null)));
    expect(screen.getByRole("link", { name: "See what’s coming up" })).toHaveAttribute(
      "href",
      "/s/blue-mantis",
    );
  });

  it("names the next date of a repeating run first", async () => {
    vi.mocked(nextPublicTripInSeries).mockResolvedValueOnce({
      id: "trip-2",
      title: "Saturday Wall",
      startsAt: new Date("2030-09-14T11:00:00.000Z"),
    });
    render(await cancelledNotice(db, input(null)));
    const next = screen.getByRole("link", { name: /^Book the next Saturday Wall: Sat,\sSep\s14/ });
    expect(next).toHaveAttribute("href", "/s/blue-mantis/trips/trip-2#book");
  });
});
