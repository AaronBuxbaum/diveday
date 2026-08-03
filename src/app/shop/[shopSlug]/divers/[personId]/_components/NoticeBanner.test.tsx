// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NoticeBanner } from "./NoticeBanner";

afterEach(cleanup);

function renderBanner(notice?: string) {
  return render(<NoticeBanner notice={notice} locale="en-US" shopSlug="reef-shop" />);
}

describe("NoticeBanner", () => {
  it("renders nothing without a notice", () => {
    const { container } = renderBanner(undefined);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a known notice", () => {
    renderBanner("booked");
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  /**
   * `notice` comes straight off the query string. A bare `NOTICE_KEYS[notice]`
   * resolves `constructor` to `Object.prototype.constructor` — a function —
   * and React throws trying to render it as a child. `noticeFromParam` is what
   * stops that; this is the test that keeps it in place.
   */
  it.each(["constructor", "__proto__", "toString", "hasOwnProperty"])(
    "renders nothing for a hostile ?notice=%s",
    (hostile) => {
      const { container } = renderBanner(hostile);
      expect(container).toBeEmptyDOMElement();
    },
  );

  it("renders nothing for an unrecognized notice", () => {
    const { container } = renderBanner("definitely-not-a-notice");
    expect(container).toBeEmptyDOMElement();
  });

  /**
   * The dead-button bug: `orders/new` bounces a shop with no payable Stripe
   * account back here with `?notice=payment-not-connected`. Before this code
   * existed in the map, that render produced nothing at all — the "New
   * payment" button visibly did nothing, every time, on every day-one shop.
   */
  describe("payment-not-connected", () => {
    it("explains why the invoice door refused", () => {
      renderBanner("payment-not-connected");
      expect(screen.getByRole("status")).toHaveTextContent(/Payments aren't connected yet/i);
    });

    it("links to the settings section that fixes it", () => {
      renderBanner("payment-not-connected");
      expect(screen.getByRole("link", { name: "Connect payments" })).toHaveAttribute(
        "href",
        "/shop/reef-shop/settings#money",
      );
    });
  });
});
