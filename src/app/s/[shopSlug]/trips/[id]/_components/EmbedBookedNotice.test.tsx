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

const readyRoute = "/s/reef-shop/trips/trip-1/ready?booking=tok";

function renderNotice(
  overrides: { readinessLink?: string; emailsOnTheWay?: boolean; payCancelled?: boolean } = {},
) {
  return renderDiver(
    <EmbedBookedNotice
      shop={shop}
      shopSlug="reef-shop"
      locale="en-US"
      trip={trip}
      confirmed={confirmed}
      readinessLink={overrides.readinessLink ?? readyRoute}
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
    expect(link).toHaveAttribute("href", readyRoute);
    expect(link).toHaveAttribute("target", "_top");
  });

  /**
   * The link used to render `href="#"` under `aria-disabled` whenever no
   * capability could be minted, styled inert with `pointer-events-none`. That
   * stops a mouse and nothing else: a keyboard Enter still activates an anchor,
   * and `#` under `target="_top"` is a *navigation* — it replaces the shop's own
   * page, the one thing this component exists to avoid (`coderabbitai`).
   *
   * It cannot happen now because the href is a route, not a minted token, and
   * the route decides at tap time — so there is no state where this component
   * has nowhere to point. Pinned rather than argued: an `href` that is empty or
   * a bare fragment is the shape of the bug, whatever reintroduces it.
   */
  it("never points the top-level window at a bare fragment", () => {
    renderNotice();
    const link = screen.getByRole("link", { name: /readiness page/ });
    const href = link.getAttribute("href") ?? "";
    expect(href.startsWith("#")).toBe(false);
    expect(href).not.toBe("");
    expect(link).not.toHaveAttribute("aria-disabled");
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
