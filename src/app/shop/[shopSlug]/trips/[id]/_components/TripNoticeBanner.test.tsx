// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { signTripAdmissionGate } from "@/lib/trip-admission-gate";
import { resolveTripNotice, TripNoticeBanner, type TripNoticeInput } from "./TripNoticeBanner";

afterEach(cleanup);
afterEach(() => vi.useRealTimers());

const TRIP = "11111111-1111-4111-8111-111111111111";
const OTHER_TRIP = "22222222-2222-4222-8222-222222222222";

function resolve(
  notice?: string,
  extra: Pick<TripNoticeInput, "gate" | "form" | "bid" | "roster"> = {},
) {
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

  it("says a refused waiver link never went out, in the shared send-limit sentence", () => {
    expect(resolve("send-limit")?.text).toBe(
      "You have sent a lot of links this hour. Nothing went out; try again in a little while.",
    );
  });

  it("keeps a booking removal's undo available after the transient toast interval", () => {
    vi.useFakeTimers();
    render(
      <TripNoticeBanner
        notice={resolve("booking-removed")}
        locale="en-US"
        undoBookingId="booking-1"
        undoAction={() => undefined}
      />,
    );

    act(() => vi.advanceTimersByTime(60_000));

    const status = screen.getByRole("status");
    expect(status).not.toHaveClass("toast-dismiss");
    expect(status).toContainElement(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeVisible();
  });

  it("keeps a refund failure and its undo beside the roster", () => {
    render(
      <TripNoticeBanner
        notice={resolve("booking-removed-refund-manual")}
        locale="en-US"
        undoBookingId="booking-1"
        undoAction={() => undefined}
      />,
    );

    const refusal = screen.getByRole("alert");
    expect(refusal).toContainElement(screen.getByRole("button", { name: "Undo" }));
    expect(refusal.querySelector('input[name="bookingId"]')).toHaveValue("booking-1");
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
  });

  /**
   * **`?gate=` must be evidence, not an instruction** (security review
   * finding). Unsigned, the param was a way for anyone who could get a staffer
   * to open a link to render a fabricated, *specific* refusal — the kind that
   * names a card and points at the certifications form, where a hand-entered
   * card lands `pending` and clears `decideTripAdmission` next attempt (H-20260725-two-findings-dive-domain).
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
        "That diver’s certifications on file don’t reach what this trip and its dive sites require",
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
      expect(banner).toHaveTextContent("don’t reach what this trip");
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

  /**
   * The two trip doors (`SEAT_SURFACES["trip-guests"]` and `["new-booking"]`)
   * land a held seat here — a booking attached to an existing diver on a guess,
   * which the boarding gate refuses until someone confirms it (H-20260724-one-person-per-email, issue
   * #1556). It used to land as the plain `diver-added`, so the staffer learned
   * the seat was held on the next tap, at the check-in queue
   * (`dive-domain-expert`, 2026-09-11). Distinct words, and a tone that is not
   * "you can walk away".
   */
  it("says a held seat is held, beside the form that seated it", () => {
    const held = resolve("diver-added-identity-unconfirmed");

    expect(held?.form).toBe("add-diver");
    expect(held?.tone).toBe("warning");
    expect(held?.text).not.toBe(resolve("diver-added")?.text);
    expect(held?.text).toMatch(/confirm/i);
  });

  /**
   * Remove refused for a diver marked aboard a boat that has left (H-20261015-aboard-diver-removal-at). The
   * name is the page's own roster's, never the URL's, so a hand-edited `bid`
   * with no seat behind it says nothing rather than a sentence about nobody.
   */
  it("names the diver Remove refused, beside the roster, and says nothing without one", () => {
    const roster = [{ booking: { id: "seat-1" }, person: { fullName: "Hugo Marsh" } }];
    const refused = resolve("booking-remove-aboard", { bid: "seat-1", roster });

    expect(refused).toEqual({
      form: "roster",
      tone: "danger",
      text: "Hugo Marsh sailed on this departure, so the booking stays. To give money back, refund their order.",
    });
    expect(resolve("booking-remove-aboard", { bid: "seat-2", roster })).toBeUndefined();
    expect(resolve("booking-remove-aboard")).toBeUndefined();
  });

  it("tells a seat nobody counted at the dock how to let it go, never that it sailed", () => {
    const roster = [{ booking: { id: "seat-1" }, person: { fullName: "Hugo Marsh" } }];

    expect(resolve("booking-remove-uncounted", { bid: "seat-1", roster })).toEqual({
      form: "roster",
      tone: "danger",
      text: "Nobody counted Hugo Marsh at the dock, so the boat may have carried them. If they didn’t come, mark them Not boarded on the manifest, then remove the booking.",
    });
    expect(resolve("booking-remove-uncounted", { bid: "seat-2", roster })).toBeUndefined();
  });
});
