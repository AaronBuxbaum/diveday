// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderDiver } from "@/test/intl";
import { EmbedBookedNotice } from "./EmbedBookedNotice";
import type { Confirmed, Shop, Trip } from "./types";

const shop = {
  id: "shop-1",
  name: "Reef Shop",
  slug: "reef-shop",
  timezone: "America/Cancun",
  dockCallMinutes: 30,
  currency: "mxn",
  rentalItems: [],
  rentalPricing: { setCents: null, perItemCents: {}, nitroxCents: null },
  contactEmail: null,
  contactPhone: null,
} as unknown as Shop;

const trip = {
  id: "trip-1",
  title: "Palancar Reef Two-Tank",
  startsAt: new Date("2026-08-14T13:00:00Z"),
  endsAt: new Date("2026-08-14T17:00:00Z"),
  plannedDives: 2,
} as unknown as Trip;

const confirmed = {
  booking: { id: "booking-1", wantsNitrox: false },
  person: { id: "person-1", fullName: "Ingrid Vogel", email: null },
} as unknown as Confirmed;

function renderNotice(
  overrides: {
    readinessLink?: string | null;
    emailsOnTheWay?: boolean;
    payCancelled?: boolean;
  } = {},
) {
  return renderDiver(
    <EmbedBookedNotice
      shop={shop}
      shopSlug="reef-shop"
      locale="en-US"
      trip={trip}
      confirmed={confirmed}
      readinessLink={overrides.readinessLink === undefined ? "/ready/tok" : overrides.readinessLink}
      emailsOnTheWay={overrides.emailsOnTheWay ?? false}
      payCancelled={overrides.payCancelled ?? false}
    />,
  );
}

afterEach(cleanup);

describe("EmbedBookedNotice", () => {
  it("greets the diver by their first name", () => {
    renderNotice();
    expect(screen.getByRole("heading", { name: /You’re on the boat, Ingrid/ })).toBeVisible();
  });

  /**
   * The load-bearing assertion of this whole component. `/ready/[token]` is
   * deliberately outside the embed framing allowlist (ADR
   * 20260726-schedule-embed), so a same-frame click swaps a working widget for
   * a frame the CSP blocks — a dead end on a shop's own website, in the one
   * moment a diver has just handed over money.
   */
  it("breaks out of the frame to reach the readiness page", () => {
    renderNotice();
    const link = screen.getByRole("link", { name: /readiness page/ });
    expect(link).toHaveAttribute("href", "/ready/tok");
    expect(link).toHaveAttribute("target", "_top");
  });

  /**
   * No origin configured means no capability could be minted. The link is inert
   * rather than absent: a diver who booked inside an iframe and is shown *no*
   * way onward has no other copy of that link — the email carrying it could not
   * be built either.
   */
  it("disables the readiness link rather than dropping it when none could be issued", () => {
    renderNotice({ readinessLink: null });
    const link = screen.getByRole("link", { name: /readiness page/ });
    expect(link).toHaveAttribute("aria-disabled", "true");
  });

  it("keeps the way back into the widget, still embedded", () => {
    renderNotice();
    expect(screen.getByRole("link", { name: /Back to the schedule/ })).toHaveAttribute(
      "href",
      "/s/reef-shop?embed=1",
    );
  });

  it("promises two emails only when both actually went out", () => {
    renderNotice({ emailsOnTheWay: false });
    expect(screen.queryByText(/Two emails are on their way/)).toBeNull();
    cleanup();
    renderNotice({ emailsOnTheWay: true });
    expect(screen.getByText(/Two emails are on their way/)).toBeVisible();
  });

  /**
   * Backing out of Stripe must not read as a failed booking: the seats were
   * committed before checkout ever started, so the seat is the fact to state.
   * The balance itself is on `/ready`, where every other payment state lives.
   */
  it("says the seat survived an abandoned payment", () => {
    renderNotice({ payCancelled: true });
    expect(screen.getByText(/Your spot is safe/)).toBeVisible();
  });

  it("says nothing about payment when none was attempted", () => {
    renderNotice({ payCancelled: false });
    expect(screen.queryByText(/Your spot is safe/)).toBeNull();
  });
});
