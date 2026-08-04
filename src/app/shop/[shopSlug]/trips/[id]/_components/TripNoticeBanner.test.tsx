// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { signTripAdmissionGate } from "@/lib/trip-admission-gate";
import { TripNoticeBanner } from "./TripNoticeBanner";

afterEach(cleanup);

const TRIP = "11111111-1111-4111-8111-111111111111";
const OTHER_TRIP = "22222222-2222-4222-8222-222222222222";

function renderBanner(notice?: string, gate?: string | string[], tripId = TRIP) {
  return render(<TripNoticeBanner notice={notice} gate={gate} tripId={tripId} locale="en-US" />);
}

const levelRefusal = {
  requiredLevel: "advanced_open_water" as const,
  heldLevel: "open_water" as const,
  missingSpecialties: [],
  nitroxRequired: false,
};

describe("TripNoticeBanner", () => {
  it("renders nothing without a notice", () => {
    const { container } = renderBanner(undefined);
    expect(container).toBeEmptyDOMElement();
  });

  /**
   * **`?gate=` must be evidence, not an instruction** (security review
   * finding). Unsigned, the param was a way for anyone who could get a staffer
   * to open a link to render a fabricated, *specific* refusal — the kind that
   * names a card and points at the certifications form, where a hand-entered
   * card lands `pending` and clears `decideTripAdmission` next attempt (H-24).
   */
  describe("diver-trip-prerequisite's structured detail", () => {
    it("names the level and the diver's card when the gate is signed for this departure", () => {
      renderBanner(
        "diver-trip-prerequisite",
        signTripAdmissionGate(levelRefusal, { kind: "trip", id: TRIP }),
      );
      const banner = screen.getByRole("alert");
      expect(banner).toHaveTextContent("This charter requires Advanced Open Water.");
      expect(banner).toHaveTextContent("highest card on file is Open Water");
    });

    it("falls back to the generic sentence on a hand-written gate", () => {
      renderBanner("diver-trip-prerequisite", "~~deep~0");
      const banner = screen.getByRole("alert");
      expect(banner).toHaveTextContent(
        "That diver's cards on file don't reach what this trip and its dive sites require",
      );
      expect(banner).not.toHaveTextContent("Deep card");
    });

    it("falls back to the generic sentence on another departure's genuine gate", () => {
      renderBanner(
        "diver-trip-prerequisite",
        signTripAdmissionGate(levelRefusal, { kind: "trip", id: OTHER_TRIP }),
      );
      const banner = screen.getByRole("alert");
      expect(banner).not.toHaveTextContent("Advanced Open Water");
      expect(banner).toHaveTextContent("don't reach what this trip");
    });

    it("renders rather than throwing on a repeated ?gate=", () => {
      expect(() =>
        renderBanner("diver-trip-prerequisite", ["~~deep~0", "~~wreck~0"]),
      ).not.toThrow();
      expect(screen.getByRole("alert")).not.toHaveTextContent("Deep card");
    });
  });
});
