// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { TripCancellation } from "./TripCancellation";

vi.mock("../details-actions", () => ({ reinstateTripAction: vi.fn() }));

afterEach(cleanup);

const t = staffTranslator("en-US");
const base = {
  cancelled: true,
  canConfigure: false,
  blowoutCalled: null,
  shopSlug: "blue-mantis",
  tripId: "trip-1",
  cancelledAt: new Date("2026-11-14T15:00:00.000Z"),
  scheduledFor: "Was scheduled for Mon, Nov 16, 9:00 AM",
  locale: "en-US",
  timeZone: "America/New_York",
  t,
};

/**
 * **A cancelled trip says so first, in a plain sentence** (layer E): what
 * happened and when, then the doors, whoever is reading. A staffer who may
 * not reinstate still reads the sentence.
 */
describe("the cancellation", () => {
  it("says when the trip was canceled, to anyone", () => {
    render(<TripCancellation {...base} />);
    expect(screen.getByText(/^Canceled on Sat, Nov\s14\.$/)).toBeVisible();
    expect(screen.getByText(base.scheduledFor)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Reinstate trip" })).toBeNull();
  });

  it("says a weather call as one, with its record and Reinstate for who may", () => {
    render(<TripCancellation {...base} canConfigure blowoutCalled="weather" />);
    expect(screen.getByText(/^Called off for weather on Sat, Nov\s14\.$/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Reinstate trip" })).toBeVisible();
    expect(screen.getByRole("link", { name: "View cancellation record" })).toBeVisible();
  });

  it("draws nothing on a trip that is not cancelled", () => {
    const { container } = render(<TripCancellation {...base} cancelled={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
