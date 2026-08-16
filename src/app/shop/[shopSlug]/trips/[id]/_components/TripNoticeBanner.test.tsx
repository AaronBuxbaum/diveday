// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { signTripAdmissionGate } from "@/lib/trip-admission-gate";
import { resolveTripNotice, TripNoticeBanner } from "./TripNoticeBanner";

afterEach(cleanup);

const TRIP = "11111111-1111-4111-8111-111111111111";
const OTHER_TRIP = "22222222-2222-4222-8222-222222222222";

function resolve(notice?: string, extra: { gate?: string | string[]; form?: string } = {}) {
  return resolveTripNotice({ notice, tripId: TRIP, locale: "en-US", ...extra });
}

function renderBanner(notice?: string, gate?: string | string[], tripId = TRIP) {
  return render(
    <TripNoticeBanner
      notice={resolveTripNotice({ notice, gate, tripId, locale: "en-US" })}
      locale="en-US"
    />,
  );
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
      expect(banner).toHaveTextContent("highest certification on file is Open Water");
    });

    it("falls back to the generic sentence on a hand-written gate", () => {
      renderBanner("diver-trip-prerequisite", "~~deep~0");
      const banner = screen.getByRole("alert");
      expect(banner).toHaveTextContent(
        "That diver's certifications on file don't reach what this trip and its dive sites require",
      );
      expect(banner).not.toHaveTextContent("Deep certification");
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
      expect(screen.getByRole("alert")).not.toHaveTextContent("Deep certification");
    });
  });
});

/**
 * The routing half: a notice has to name the form it answers, or the page is
 * back to one banner under the `<h1>` for six forms spread down a long page.
 */
describe("resolveTripNotice", () => {
  it("sends each code home to the form that produced it", () => {
    expect(resolve("saved")?.form).toBe("details");
    expect(resolve("conditions")?.form).toBe("conditions");
    expect(resolve("requirements-blocking")?.form).toBe("requirements");
    expect(resolve("series-repeating")?.form).toBe("series");
    expect(resolve("last-minute-sent")?.form).toBe("last-minute-deal");
    expect(resolve("diver-full")?.form).toBe("add-diver");
    expect(resolve("cancelled")?.form).toBe("lifecycle");
  });

  it("lets an action name the form when the code alone cannot", () => {
    // `invalid` is emitted by the details editor, the conditions briefing, the
    // recap note, and the payment control alike — only the action knows which.
    expect(resolve("invalid")?.form).toBe("page");
    expect(resolve("invalid", { form: "conditions" })?.form).toBe("conditions");
    expect(resolve("invalid", { form: "recap-note" })?.form).toBe("recap-note");
  });

  it("ignores a ?form= naming no form on this page", () => {
    // A query param is attacker-supplied: an unknown name must degrade to the
    // code's own home rather than routing the notice into nothing.
    expect(resolve("invalid", { form: "constructor" })?.form).toBe("page");
    expect(resolve("saved", { form: "../../etc" })?.form).toBe("details");
  });

  it("still refuses an unrecognized notice code outright", () => {
    expect(resolve("constructor")).toBeUndefined();
    expect(resolve(undefined)).toBeUndefined();
  });
});
