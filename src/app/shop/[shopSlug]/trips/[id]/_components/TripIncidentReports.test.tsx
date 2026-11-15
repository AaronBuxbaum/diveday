// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TripIncidentReports } from "./TripIncidentReports";

vi.mock("@/db/client", () => ({ getDb: async () => ({}) }));
vi.mock("@/db/incident-reports", () => ({
  listTripIncidentReports: async () => ({ mayStart: false, reports: [] }),
}));
vi.mock("@/i18n/request", () => ({ requestLocale: async () => "en-US" }));
vi.mock("../incidents/actions", () => ({ startIncidentReportAction: vi.fn() }));
afterEach(cleanup);

it("renders nothing when there is no incident report access", async () => {
  const result = await TripIncidentReports({
    shop: { id: "shop", slug: "blue-mantis", timezone: "UTC", defaultLocale: "en-US" },
    personId: "owner",
    tripId: "trip-1",
  });
  expect(result).toBeNull();
});
