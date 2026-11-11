// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { DateInterestRow, DepartureOnTheBoard } from "@/db/interest-dates";
import { staffTranslator } from "@/i18n/staff-messages";
import { RequestDayPlan } from "./RequestDayPlan";

afterEach(cleanup);
const request: DateInterestRow = {
  id: "request",
  courseId: null,
  courseTitle: null,
  interest: "Wrecks",
  personId: null,
  name: null,
  email: null,
  phone: null,
  experienceLevel: null,
  timing: null,
  preferredDate: "2027-03-06",
  alternateDate: null,
  dateFlexible: false,
  partySize: 4,
  message: null,
  askedAt: new Date("2027-01-01T00:00:00Z"),
  closedAt: null,
  closedAs: null,
  charter: false,
  charterQuoteCents: null,
  charterQuoteCurrency: null,
  charterQuotedAt: null,
  replyUnsettled: false,
};
const departure: DepartureOnTheBoard = {
  tripId: "trip",
  title: "Reef morning",
  startsAt: new Date("2027-03-06T14:00:00Z"),
  date: "2027-03-06",
  seatsLeft: 2,
  assignedCrewCount: 1,
  isPrivate: false,
};
function draw(departures = [departure], crewEnabled = true, party = request, locale = "en-US") {
  return render(
    <RequestDayPlan
      date="2027-03-06"
      entries={[{ request: party, match: "preferred", homeDate: "2027-03-06" }]}
      departures={departures}
      crewEnabled={crewEnabled}
      crewAwayCountByTrip={new Map([["trip", 1]])}
      shopSlug="blue-mantis"
      locale={locale}
      timezone="America/New_York"
      t={staffTranslator(locale === "es-ES" ? "es-ES" : "en-US")}
    />,
  );
}
it("compares each departure separately and links to the requested week's crew schedule", () => {
  const { container } = draw();
  expect(screen.getByText("2 seats left")).toBeTruthy();
  expect(screen.getByText("1 crew member assigned")).toBeTruthy();
  expect(screen.getByText("1 assigned crew member has time away to confirm")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Check the crew schedule" }).getAttribute("href")).toBe(
    "/shop/blue-mantis/staffing?week=2027-03-01",
  );
  expect(container.querySelector('[aria-hidden="true"] [style]')?.getAttribute("style")).toContain(
    "scaleX(0.5)",
  );
});
it("does not present private departures as open seats or assignments when disabled", () => {
  draw([{ ...departure, isPrivate: true }], false);
  expect(screen.getByText("Private departure")).toBeTruthy();
  expect(screen.queryByText("2 seats left")).toBeNull();
  expect(screen.queryByText("1 crew member assigned")).toBeNull();
  expect(screen.queryByRole("link", { name: "Check the crew schedule" })).toBeNull();
});
it("shows missing party sizes without inventing seats to fill", () => {
  const { container } = draw([], true, { ...request, partySize: null });
  expect(screen.getByText(/1 party size unknown/)).toBeTruthy();
  expect(screen.getByText("No scheduled departure on this date.")).toBeTruthy();
  expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
});
it("does not draw a shared-seat comparison for a charter and renders Spanish copy", () => {
  const { container } = draw([departure], true, { ...request, charter: true }, "es-ES");
  expect(screen.getByText(/1 solicitud de barco completo/)).toBeTruthy();
  expect(screen.getByText("2 plazas libres")).toBeTruthy();
  expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
});

it("distinguishes same-title departures by their shop-local departure time", () => {
  draw([
    departure,
    { ...departure, tripId: "afternoon", startsAt: new Date("2027-03-06T19:00:00Z") },
  ]);
  expect(screen.getByRole("link", { name: /9:00\sAM.*Reef morning/ })).toBeTruthy();
  expect(screen.getByRole("link", { name: /2:00\sPM.*Reef morning/ })).toBeTruthy();
});
