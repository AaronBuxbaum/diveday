// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TripIncidentReports } from "./TripIncidentReports";

vi.mock("@/db/client", () => ({ getDb: async () => ({}) }));
vi.mock("@/db/incident-reports", () => ({
  listTripIncidentReports: async () => ({ mayStart: false, reports: [] }),
}));
vi.mock("@/i18n/request", () => ({ requestLocale: async () => "en-US" }));
vi.mock("../incidents/actions", () => ({ startIncidentReportAction: vi.fn() }));
vi.mock("./DepartureLogLink", () => ({
  DepartureLogLink: ({ tripId }: { tripId: string }) => (
    <a href={`/log/${tripId}`}>Departure log</a>
  ),
}));
afterEach(cleanup);

it("keeps the departure log in Details records even without incident report access", async () => {
  render(
    await TripIncidentReports({
      shop: { id: "shop", slug: "blue-mantis", timezone: "UTC", defaultLocale: "en-US" },
      personId: "owner",
      tripId: "trip-1",
    }),
  );
  expect(screen.getByRole("link", { name: "Departure log" }).getAttribute("href")).toBe(
    "/log/trip-1",
  );
});
