// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { TripHeader } from "./TripHeader";

vi.mock("../incidents/actions", () => ({ startIncidentReportAction: vi.fn() }));
afterEach(cleanup);

const t = staffTranslator("en-US");
const props = {
  trip: {
    title: "Two-Tank Reef",
    startsAt: new Date("2026-11-25T16:30:00Z"),
    endsAt: new Date("2026-11-25T20:00:00Z"),
  },
  facts: [],
  shopSlug: "blue-mantis",
  tripId: "trip-1",
  rollCall: "more" as const,
  addGuest: false,
  locale: "en-US",
  timeZone: "America/New_York",
  t,
};

function openMore() {
  fireEvent.click(screen.getByRole("button", { name: t("trips.clock.more") }));
}

it("offers Report an incident in More to a viewer who may start one", () => {
  render(<TripHeader {...props} reportIncident />);
  openMore();
  expect(screen.getByRole("button", { name: t("trips.clock.reportIncident") })).toBeVisible();
});

it("has no incident door for a viewer who may not start one", () => {
  render(<TripHeader {...props} reportIncident={false} />);
  openMore();
  expect(screen.queryByRole("button", { name: t("trips.clock.reportIncident") })).toBeNull();
});
