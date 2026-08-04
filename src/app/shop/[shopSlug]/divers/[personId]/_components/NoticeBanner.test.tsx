// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { signTripAdmissionGate } from "@/lib/trip-admission-gate";
import { NoticeBanner } from "./NoticeBanner";

afterEach(cleanup);

const PERSON = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_PERSON = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function renderBanner(notice?: string, gate?: string | string[], personId = PERSON) {
  return render(
    <NoticeBanner
      notice={notice}
      gate={gate}
      locale="en-US"
      shopSlug="reef-shop"
      personId={personId}
    />,
  );
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
   * **`?gate=` must be evidence, not an instruction** (security review
   * finding).
   *
   * This banner is the surface the old static copy sent staff to ("Add the
   * missing card above"), which makes it the one where a *forged* specific
   * refusal does the most damage: "their Deep card isn't on file" points a
   * staffer straight at the certifications form, and a hand-entered card lands
   * `pending` — which clears `decideTripAdmission` on the next attempt (H-24).
   * So a value nobody signed must degrade to the generic sentence, and never
   * to the specific one or to nothing at all.
   */
  describe("trip_prerequisite's structured detail", () => {
    const deepCardRefusal = {
      requiredLevel: null,
      heldLevel: null,
      missingSpecialties: ["deep" as const],
      nitroxRequired: false,
    };

    it("says which card is missing when the gate is signed for this diver", () => {
      renderBanner(
        "trip_prerequisite",
        signTripAdmissionGate(deepCardRefusal, {
          kind: "diver",
          id: PERSON,
        }),
      );
      expect(screen.getByRole("status")).toHaveTextContent(
        "This charter requires a Deep card. There's none on this diver's record.",
      );
    });

    it("falls back to the generic sentence on a hand-written gate", () => {
      // The exact forgery from the review: well-formed to the codec, signed by
      // nobody.
      renderBanner("trip_prerequisite", "~~deep~0");
      const banner = screen.getByRole("status");
      expect(banner).toHaveTextContent(
        "This diver's cards on file don't reach what that trip and its dive sites require",
      );
      expect(banner).not.toHaveTextContent("Deep card");
    });

    it("falls back to the generic sentence on another diver's genuine gate", () => {
      renderBanner(
        "trip_prerequisite",
        signTripAdmissionGate(deepCardRefusal, { kind: "diver", id: OTHER_PERSON }),
      );
      expect(screen.getByRole("status")).not.toHaveTextContent("Deep card");
    });

    it("still renders the banner — never a blank one — when the gate is absent", () => {
      renderBanner("trip_prerequisite");
      expect(screen.getByRole("status")).toHaveTextContent(
        "This diver's cards on file don't reach what that trip and its dive sites require",
      );
    });

    it("renders rather than throwing on a repeated ?gate=", () => {
      expect(() => renderBanner("trip_prerequisite", ["~~deep~0", "~~wreck~0"])).not.toThrow();
      expect(screen.getByRole("status")).not.toHaveTextContent("Deep card");
    });
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
